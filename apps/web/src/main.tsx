import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { initI18n } from './i18n';
import { api } from './lib/api';
import { keys } from './lib/queries';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: true },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

// The workspace language (taskpack.yaml: lang) decides the UI language before the first paint.
const config = await api.config().catch(() => undefined);
if (config) queryClient.setQueryData(keys.config, config);
await initI18n(config?.lang ?? (navigator.language.startsWith('pl') ? 'pl' : 'en'));

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
