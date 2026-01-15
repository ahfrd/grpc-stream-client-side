import React from 'react';
import ReactDOM from 'react-dom/client';
import MarketTrendClient from './MarketTrendClient';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MarketTrendClient envoyUrl="http://localhost:8080" />
  </React.StrictMode>
);
