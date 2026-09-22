import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('App ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-spotify-black text-white flex flex-col items-center justify-center p-6 text-center select-none" dir="rtl">
          <div className="w-16 h-16 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mb-4 text-2xl font-bold">
            ⚠️
          </div>
          <h1 className="text-2xl font-black mb-2">אירעה שגיאה בטעינת האפליקציה</h1>
          <p className="text-spotify-subtext text-sm max-w-md mb-6">
            נראה שהדפדפן שמר גרסה ישנה במטמון או חלה שגיאה זמנית. רענון קצר יפתור את הבעיה.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="bg-spotify-green hover:bg-spotify-green-hover text-black font-bold px-6 py-3 rounded-full text-sm transition-all"
            >
              רענן דף עכשיו
            </button>
            <button
              onClick={() => {
                localStorage.clear();
                window.location.reload();
              }}
              className="bg-white/10 hover:bg-white/20 text-white font-medium px-4 py-3 rounded-full text-sm transition-all"
            >
              איפוס נתונים מקומיים
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
