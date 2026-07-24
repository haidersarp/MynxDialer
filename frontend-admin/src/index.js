import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
// basename adapts to where the app is served: '' at root (IP setup), '/admin'
// when built with PUBLIC_URL=/admin (the your-domain.com/admin proxy). Works for both.
root.render(
  <BrowserRouter basename={process.env.PUBLIC_URL || '/'}>
    <App />
  </BrowserRouter>
);
