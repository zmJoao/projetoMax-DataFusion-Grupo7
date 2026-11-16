import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const dashboard = {
  generated_at: '2026-11-15T12:00:00Z',
  last_sync: null,
  data_notice: 'Dados agregados demonstrativos.',
  air_quality_source: 'Open-Meteo',
  metrics: {
    respiratory_visits: 1280,
    change_percent: 8.3,
    average_pm25: 12.1,
    alerts: 1,
    monitored_regions: 1,
  },
  monthly_trend: [{ label: 'Mai', cases: 1200, previous: 1100 }],
  regions: [{
    code: 'CPQ',
    name: 'Campinas',
    state: 'SP',
    population: 1139047,
    cases: 1280,
    risk_score: 59,
    status: 'Moderado',
    pm25: 12.1,
    change_percent: 8.3,
  }],
  alerts: [],
  storage: { sqlite: 'connected', duckdb: 'connected', mongodb: 'disconnected' },
};

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => dashboard,
  }) as jest.Mock;
});

test('renders the health observatory and its integrated regional data', async () => {
  render(<App />);

  expect(await screen.findByRole('heading', { name: /saúde que antecipa/i })).toBeInTheDocument();
  expect((await screen.findAllByText('Campinas')).length).toBeGreaterThan(0);
  expect(screen.getByText(/dados agregados demonstrativos/i)).toBeInTheDocument();
});

test('filters municipalities by name', async () => {
  render(<App />);
  await screen.findByRole('textbox', { name: /buscar município/i });

  fireEvent.change(screen.getByRole('textbox', { name: /buscar município/i }), { target: { value: 'inexistente' } });

  await waitFor(() => expect(screen.getByText(/nenhum município encontrado/i)).toBeInTheDocument());
});

test('shows an actionable error when the API cannot be reached', async () => {
  (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Failed to fetch'));
  render(<App />);

  expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível conectar/i);
});
