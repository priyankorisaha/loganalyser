/* Central API configuration for local, Render, and Vercel deployments. */
(function configureApiBase() {
  const DEFAULT_API_BASE = 'https://loganalyser-backend.onrender.com/api';

  function normalizeApiBase(value) {
    return String(value || DEFAULT_API_BASE).replace(/\/+$/, '');
  }

  function getSavedApiBase() {
    try {
      const settings = JSON.parse(localStorage.getItem('ll_settings') || '{}');
      return settings.apiUrl;
    } catch (_) {
      return null;
    }
  }

  window.LOGANALYSER_DEFAULT_API_BASE = DEFAULT_API_BASE;
  window.LOGANALYSER_API_BASE = normalizeApiBase(getSavedApiBase() || DEFAULT_API_BASE);
})();
