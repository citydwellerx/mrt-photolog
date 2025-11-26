import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

console.log("Initializing App...");

const container = document.getElementById('root');

if (container) {
  try {
    const root = createRoot(container);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log("App rendered successfully.");
  } catch (error) {
    console.error("Error rendering app:", error);
    container.innerHTML = `<div style="padding: 20px; color: red;">Failed to start application: ${error instanceof Error ? error.message : String(error)}</div>`;
  }
} else {
  console.error("Failed to find the root element.");
}