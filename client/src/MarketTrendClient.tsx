import React, { useState, useEffect, useRef } from 'react';
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import { DataStreamClient } from './generated/datastream.client';
import { FilterRequest, DataStreamResponse, EStockInfo } from './generated/datastream';

interface MarketTrendClientProps {
  envoyUrl?: string;
}

export const MarketTrendClient: React.FC<MarketTrendClientProps> = ({ 
  envoyUrl = 'http://localhost:8080' 
}) => {
  const [stocks, setStocks] = useState<EStockInfo[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('percent_change');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [messageCount, setMessageCount] = useState(0);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const clientRef = useRef<DataStreamClient | null>(null);

  // Initialize gRPC-Web client
  useEffect(() => {
    const transport = new GrpcWebFetchTransport({
      baseUrl: envoyUrl,
      // Optional: Add interceptors, metadata, etc.
      // meta: { 'authorization': 'Bearer token' }
    });

    clientRef.current = new DataStreamClient(transport);

    return () => {
      disconnect();
    };
  }, [envoyUrl]);

  const connectToStream = async () => {
    if (!clientRef.current) {
      setError('gRPC client not initialized');
      return;
    }

    try {
      setIsConnected(true);
      setError(null);
      setStocks([]);
      setMessageCount(0);

      // Create abort controller for cancellation
      abortControllerRef.current = new AbortController();

      const request: FilterRequest = {
        filter: filter,
        sort: sortBy,
      };

      console.log('🚀 Starting gRPC stream with:', request);

      // Call the server streaming method
      const call = clientRef.current.streamData(request, {
        abort: abortControllerRef.current.signal,
      });

      let count = 0;

      // Listen to streaming responses
      for await (const response of call.responses) {
        count++;
        setMessageCount(count);

        console.log(`📨 Received message #${count}:`, {
          code: response.code,
          stockCount: response.data?.length || 0,
          message: response.message,
        });

        if (response.code === 200 && response.data) {
          setStocks(response.data);
          setLastUpdate(new Date());
        } else {
          console.warn('Unexpected response:', response);
        }
      }

      // Stream completed
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
      setIsConnected(false);
      abortControllerRef.current = null;
    }
  };

  const disconnect = () => {
    if (abortControllerRef.current) {
      console.log('🛑 Disconnecting stream...');
      abortControllerRef.current.abort();
    }
  };

  // Auto-connect when filter or sort changes
  useEffect(() => {
    if (isConnected) {
      disconnect();
    }
    
    const timer = setTimeout(() => {
      connectToStream();
    }, 100);

    return () => {
      clearTimeout(timer);
      disconnect();
    };
  }, [filter, sortBy]);

  // Format numbers
  const formatNumber = (num: number): string => {
    return new Intl.NumberFormat('id-ID').format(num);
  };

  const formatPrice = (price: number): string => {
    return new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(price);
  };

  const getChangeColor = (change: number): string => {
    if (change > 0) return 'text-green-600 bg-green-50';
    if (change < 0) return 'text-red-600 bg-red-50';
    return 'text-gray-600 bg-gray-50';
  };

  const getChangeIcon = (change: number): string => {
    if (change > 0) return '▲';
    if (change < 0) return '▼';
    return '●';
  };

  // Calculate statistics
  const stats = {
    total: stocks.length,
    gainers: stocks.filter(s => s.change && s.change > 0).length,
    losers: stocks.filter(s => s.change && s.change < 0).length,
    unchanged: stocks.filter(s => s.change === 0).length,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-4xl font-bold text-gray-800 mb-2">
                📈 Market Trend Stream
              </h1>
              <p className="text-gray-600">
                Real-time stock market data via gRPC-Web + Envoy
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${
                  isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                }`} />
                <span className="text-sm font-semibold">
                  {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
                </span>
              </div>
              {lastUpdate && (
                <span className="text-xs text-gray-500">
                  Last update: {lastUpdate.toLocaleTimeString('id-ID')}
                </span>
              )}
              <span className="text-xs text-gray-500">
                Messages: {messageCount}
              </span>
            </div>
          </div>

          {/* Controls */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                📊 Filter
              </label>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                disabled={isConnected}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="all">All Stocks</option>
                <option value="idx30">IDX30</option>
                <option value="lq45">LQ45</option>
                <option value="kompas100">Kompas100</option>
                <option value="sri-kehati">SRI-KEHATI</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                🔄 Sort By
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                disabled={isConnected}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="percent_change">% Change</option>
                <option value="volume">Volume</option>
                <option value="value">Value</option>
                <option value="frequency">Frequency</option>
                <option value="code">Code</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                onClick={isConnected ? disconnect : connectToStream}
                className={`w-full px-6 py-2 rounded-lg font-semibold transition-all duration-200 shadow-md hover:shadow-lg ${
                  isConnected
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {isConnected ? '🛑 Disconnect' : '▶️ Connect'}
              </button>
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
          <div className="bg-white rounded-lg shadow-md p-4 border-l-4 border-blue-500">
            <div className="text-sm text-gray-600 font-medium">Total Stocks</div>
            <div className="text-3xl font-bold text-gray-800 mt-1">{stats.total}</div>
          </div>
          <div className="bg-white rounded-lg shadow-md p-4 border-l-4 border-green-500">
            <div className="text-sm text-gray-600 font-medium">Gainers</div>
            <div className="text-3xl font-bold text-green-600 mt-1">{stats.gainers}</div>
          </div>
          <div className="bg-white rounded-lg shadow-md p-4 border-l-4 border-red-500">
            <div className="text-sm text-gray-600 font-medium">Losers</div>
            <div className="text-3xl font-bold text-red-600 mt-1">{stats.losers}</div>
          </div>
          <div className="bg-white rounded-lg shadow-md p-4 border-l-4 border-gray-500">
            <div className="text-sm text-gray-600 font-medium">Unchanged</div>
            <div className="text-3xl font-bold text-gray-600 mt-1">{stats.unchanged}</div>
          </div>
        </div>

        {/* Stock Table */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Code
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Price
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Change
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">
                    % Change
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Volume
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Value (M)
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Freq
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {stocks.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-16 text-center">
                      {isConnected ? (
                        <div className="flex flex-col items-center">
                          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4" />
                          <span className="text-gray-600 font-medium">Waiting for market data...</span>
                          <span className="text-gray-400 text-sm mt-2">Connected to gRPC stream</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center">
                          <span className="text-6xl mb-4">📊</span>
                          <span className="text-gray-600 font-medium">Not connected</span>
                          <span className="text-gray-400 text-sm mt-2">Click Connect to start streaming</span>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  stocks.map((stock, index) => (
                    <tr
                      key={stock.code || index}
                      className="hover:bg-gray-50 transition-colors duration-150"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-mono font-bold text-gray-900 text-sm">
                          {stock.code}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-700 font-medium">
                          {stock.name}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="font-semibold text-gray-900">
                          {formatPrice(stock.price || 0)}
                        </span>
                      </td>
                      <td className={`px-6 py-4 whitespace-nowrap text-right`}>
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded ${getChangeColor(stock.change || 0)} font-semibold text-sm`}>
                          <span className="text-xs">{getChangeIcon(stock.change || 0)}</span>
                          {stock.change && stock.change > 0 ? '+' : ''}
                          {formatPrice(stock.change || 0)}
                        </span>
                      </td>
                      <td className={`px-6 py-4 whitespace-nowrap text-right`}>
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white rounded-lg shadow">
            <span className="text-sm text-gray-600">
              Powered by <strong>gRPC-Web</strong> + <strong>Envoy</strong>
            </span>
            <span className="text-gray-400">•</span>
            <span className="text-sm text-gray-500">
              Real-time streaming
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketTrendClient;