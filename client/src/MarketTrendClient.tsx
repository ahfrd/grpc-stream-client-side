import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import { DataStreamClient } from './generated/datastream.client';
import { FilterRequest, DataStreamResponse, EStockInfo } from './generated/datastream';

interface MarketTrendClientProps {
  envoyUrl?: string;
}

export const MarketTrendClient: React.FC<MarketTrendClientProps> = ({ 
  envoyUrl = 'http://localhost:8080' 
}) => {
  // Use Map for O(1) lookups instead of array
  const [stocksMap, setStocksMap] = useState<Map<string, EStockInfo>>(new Map());
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('ordinary-stock');
  const [sortBy, setSortBy] = useState('value');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [messageCount, setMessageCount] = useState(0);
  const [serverHealth, setServerHealth] = useState<string>('checking...');
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const clientRef = useRef<DataStreamClient | null>(null);

  // Convert Map to sorted array only when needed (memoized)
  const stocks = useMemo(() => {
    const stockArray = Array.from(stocksMap.values());
    
    // Sort based on selected criteria
    switch (sortBy) {
      case 'percent_change':
        return stockArray.sort((a, b) => (b.percentChange || 0) - (a.percentChange || 0));
      case 'volume':
        return stockArray.sort((a, b) => (b.totalVolume || 0) - (a.totalVolume || 0));
      case 'value':
        return stockArray.sort((a, b) => (b.value || 0) - (a.value || 0));
      case 'freq':
        return stockArray.sort((a, b) => (b.totalFreq || 0) - (a.totalFreq || 0));
      case 'code':
        return stockArray.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
      default:
        return stockArray;
    }
  }, [stocksMap, sortBy]);

  // Calculate statistics (memoized)
  const stats = useMemo(() => ({
    total: stocksMap.size,
    gainers: Array.from(stocksMap.values()).filter(s => s.change && s.change > 0).length,
    losers: Array.from(stocksMap.values()).filter(s => s.change && s.change < 0).length,
    unchanged: Array.from(stocksMap.values()).filter(s => s.change === 0).length,
  }), [stocksMap]);

  // Initialize gRPC-Web client
  useEffect(() => {
    const transport = new GrpcWebFetchTransport({
      baseUrl: envoyUrl,
    });

    clientRef.current = new DataStreamClient(transport);

    return () => {
      disconnect();
    };
  }, [envoyUrl]);

  // Check server health on mount
  useEffect(() => {
    checkHealth();
  }, []);

  const checkHealth = async () => {
    try {
      const response = await fetch(`${envoyUrl}/health`);
      const data = await response.json();
      setServerHealth(data.status === 'healthy' ? '✅ Connected' : '⚠️ Degraded');
    } catch (err) {
      setServerHealth('❌ Disconnected');
    }
  };

  const connectToStream = async () => {
    if (!clientRef.current) {
      setError('gRPC client not initialized');
      return;
    }

    try {
      setIsStreaming(true);
      setError(null);
      setStocksMap(new Map()); // Clear map
      setMessageCount(0);

      abortControllerRef.current = new AbortController();

      const request: FilterRequest = {
        filter: filter,
        sort: sortBy,
      };

      console.log('🚀 Starting gRPC stream with:', request);

      const call = clientRef.current.streamData(request, {
        abort: abortControllerRef.current.signal,
      });

      let count = 0;

      // Listen to streaming responses
      for await (const response of call.responses) {
        count++;
        setMessageCount(count);

        if (response.code === 200 && response.data) {
          // Update map efficiently - only changed stocks
          setStocksMap(prevMap => {
            const newMap = new Map(prevMap);
            
            response.data.forEach(stock => {
              if (stock.code) {
                newMap.set(stock.code, stock);
              }
            });
            
            return newMap;
          });
          
          setLastUpdate(new Date());
          
          if (count === 1) {
            console.log(`📊 Initial load: ${response.data.length} stocks`);
          } else {
            console.log(`🔄 Updated: ${response.data.length} stocks`);
          }
        }
      }

      const status = await call.status;
      console.log('✅ Stream completed with status:', status);

    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('🛑 Stream cancelled by user');
      } else {
        const errorMessage = err.message || 'An error occurred during streaming';
        setError(errorMessage);
        console.error('❌ Streaming error:', err);
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const disconnect = useCallback(() => {
    if (abortControllerRef.current) {
      console.log('🛑 Disconnecting stream...');
      abortControllerRef.current.abort();
    }
  }, []);

  // Memoized format functions
  const formatNumber = useCallback((num: number): string => {
    return new Intl.NumberFormat('id-ID').format(num);
  }, []);

  const formatPrice = useCallback((price: number): string => {
    return new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(price);
  }, []);

  const getChangeColor = useCallback((change: number): string => {
    if (change > 0) return 'text-green-600 bg-green-50';
    if (change < 0) return 'text-red-600 bg-red-50';
    return 'text-gray-600 bg-gray-50';
  }, []);

  const getChangeIcon = useCallback((change: number): string => {
    if (change > 0) return '▲';
    if (change < 0) return '▼';
    return '●';
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-3xl font-bold text-gray-800">
              📈 Market Trend Stream
            </h1>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Server:</span>
              <span className="text-sm font-mono px-3 py-1 bg-gray-100 rounded">
                {serverHealth}
              </span>
              <button
                onClick={checkHealth}
                className="text-blue-600 hover:text-blue-800 text-sm"
              >
                🔄
              </button>
            </div>
          </div>
          <p className="text-gray-600">
            Real-time stock market data via gRPC-Web + Envoy
          </p>
        </div>

        {/* Controls */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                📊 Filter
              </label>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                disabled={isStreaming}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
              >
                <option value="all">All Stocks</option>
                <option value="idx30">IDX30</option>
                <option value="lq45">LQ45</option>
                <option value="kompas100">Kompas100</option>
                <option value="sri-kehati">SRI-KEHATI</option>
                <option value="ordinary-stock">Ordinary Stock</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                🔄 Sort By
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                disabled={isStreaming}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
              >
                <option value="percent_change">% Change</option>
                <option value="volume">Volume</option>
                <option value="value">Value</option>
                <option value="freq">Frequency</option>
                <option value="code">Code</option>
              </select>
            </div>

            <div className="flex items-end gap-3">
              <button
                onClick={isStreaming ? disconnect : connectToStream}
                disabled={!isStreaming && (!filter || !sortBy)}
                className={`flex-1 px-6 py-3 rounded-lg font-medium transition-all duration-200 shadow-md hover:shadow-lg ${
                  isStreaming
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-300 disabled:cursor-not-allowed'
                }`}
              >
                {isStreaming ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Streaming...
                  </span>
                ) : (
                  'Start Stream'
                )}
              </button>
              {isStreaming && (
                <button
                  type="button"
                  onClick={disconnect}
                  className="px-6 py-3 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-all duration-200 shadow-md hover:shadow-lg"
                >
                  Stop
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded-lg shadow">
            <div className="flex items-start">
              <span className="text-2xl mr-3">⚠️</span>
              <div>
                <h3 className="font-semibold text-red-800">Connection Error</h3>
                <p className="text-red-700 text-sm mt-1">{error}</p>
                <p className="text-red-600 text-xs mt-2">
                  Make sure Envoy proxy is running on {envoyUrl}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Statistics Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg shadow-md p-4 border-l-4 border-blue-500">
            <div className="text-sm text-gray-600 font-medium mb-1">Total Stocks</div>
            <div className="text-3xl font-bold text-gray-800">{stats.total}</div>
            {isStreaming && stats.total > 0 && (
              <div className="flex items-center gap-2 text-blue-600 mt-2">
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
                <span className="text-xs font-medium">Live</span>
              </div>
            )}
          </div>
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg shadow-md p-4 border-l-4 border-green-500">
            <div className="text-sm text-gray-600 font-medium mb-1">Gainers</div>
            <div className="text-3xl font-bold text-green-600">{stats.gainers}</div>
          </div>
          <div className="bg-gradient-to-r from-red-50 to-rose-50 rounded-lg shadow-md p-4 border-l-4 border-red-500">
            <div className="text-sm text-gray-600 font-medium mb-1">Losers</div>
            <div className="text-3xl font-bold text-red-600">{stats.losers}</div>
          </div>
          <div className="bg-gradient-to-r from-gray-50 to-slate-50 rounded-lg shadow-md p-4 border-l-4 border-gray-500">
            <div className="text-sm text-gray-600 font-medium mb-1">Messages</div>
            <div className="text-3xl font-bold text-gray-600">{messageCount}</div>
          </div>
        </div>

        {/* Stock Table */}
        <div className="bg-white rounded-lg shadow-lg">
          <div className="flex items-center justify-between p-6 pb-4 border-b">
            <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
              <span>📨</span>
              Market Data
            </h2>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">
                {stocks.length} stock{stocks.length !== 1 ? 's' : ''}
              </span>
              {lastUpdate && (
                <span className="text-xs text-gray-500">
                  Last update: {lastUpdate.toLocaleTimeString('id-ID')}
                </span>
              )}
            </div>
          </div>

          {/* Loading State */}
          {isStreaming && stocks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="relative">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-8 w-8 bg-blue-100 rounded-full"></div>
                </div>
              </div>
              <p className="mt-4 text-gray-600">Waiting for market data from server...</p>
            </div>
          )}

          {/* Table */}
          {stocks.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Code</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Name</th>
                    <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">Price</th>
                    <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">Change</th>
                    <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">% Change</th>
                    <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">Volume</th>
                    <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">Value (M)</th>
                    <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">Freq</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {stocks.map((stock) => (
                    <StockRow
                      key={stock.code}
                      stock={stock}
                      formatNumber={formatNumber}
                      formatPrice={formatPrice}
                      getChangeColor={getChangeColor}
                      getChangeIcon={getChangeIcon}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Empty State */}
          {!isStreaming && stocks.length === 0 && (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">📭</div>
              <p className="text-gray-500 text-lg">No market data yet</p>
              <p className="text-gray-400 text-sm mt-2">
                Select filter and sort options, then click "Start Stream" to begin
              </p>
            </div>
          )}
        </div>

        {/* Server Info */}
        <div className="mt-6 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg shadow-lg p-6">
          <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
            <span>🔧</span>
            Server Information
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="bg-white/10 rounded p-3">
              <span className="font-medium">Server Type:</span>
              <span className="ml-2">Go gRPC Server</span>
            </div>
            <div className="bg-white/10 rounded p-3">
              <span className="font-medium">Protocol:</span>
              <span className="ml-2">gRPC-Web via Envoy</span>
            </div>
            <div className="bg-white/10 rounded p-3">
              <span className="font-medium">Envoy Proxy:</span>
              <span className="ml-2 font-mono text-xs">{envoyUrl}</span>
            </div>
            <div className="bg-white/10 rounded p-3">
              <span className="font-medium">gRPC Port:</span>
              <span className="ml-2 font-mono text-xs">localhost:9094</span>
            </div>
          </div>
          <div className="mt-3 text-xs opacity-75">
            ✨ Production-ready gRPC-Web streaming with Envoy proxy
          </div>
        </div>
      </div>
    </div>
  );
};

// Memoized row component - only re-renders if stock data changes
const StockRow = React.memo<{
  stock: EStockInfo;
  formatNumber: (num: number) => string;
  formatPrice: (price: number) => string;
  getChangeColor: (change: number) => string;
  getChangeIcon: (change: number) => string;
}>(({ stock, formatNumber, formatPrice, getChangeColor, getChangeIcon }) => {
  return (
    <tr className="hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 transition-all duration-150">
      <td className="px-6 py-4 whitespace-nowrap">
        <span className="font-mono font-bold text-gray-900 text-sm">{stock.code}</span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span className="text-sm text-gray-700 font-medium">{stock.name}</span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right">
        <span className="font-semibold text-gray-900">{formatPrice(stock.price || 0)}</span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right">
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded ${getChangeColor(stock.change || 0)} font-semibold text-sm`}>
          <span className="text-xs">{getChangeIcon(stock.change || 0)}</span>
          {stock.change && stock.change > 0 ? '+' : ''}
          {formatPrice(stock.change || 0)}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right">
        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full ${getChangeColor(stock.change || 0)} font-bold`}>
          {stock.percentChange && stock.percentChange > 0 ? '+' : ''}
          {(stock.percentChange || 0).toFixed(2)}%
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-700">
        {formatNumber(stock.totalVolume || 0)}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-700">
        {((stock.value || 0) / 1_000_000).toFixed(2)}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-700">
        {formatNumber(stock.totalFreq || 0)}
      </td>
    </tr>
  );
});

StockRow.displayName = 'StockRow';

export default MarketTrendClient;