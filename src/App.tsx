import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';

type Region = {
  code: string;
  name: string;
  state: string;
  population: number;
  cases: number;
  risk_score: number;
  status: 'Baixo' | 'Moderado' | 'Alto';
  pm25: number;
  change_percent: number;
};

type MonthlyTrend = {
  label: string;
  cases: number;
  previous: number;
};

type Alert = {
  id: string;
  level: 'Atenção' | 'Alto';
  title: string;
  description: string;
  region: string;
};

type DashboardData = {
  generated_at: string;
  last_sync: string | null;
  data_notice: string;
  air_quality_source: string;
  metrics: {
    respiratory_visits: number;
    change_percent: number;
    average_pm25: number;
    alerts: number;
    monitored_regions: number;
  };
  monthly_trend: MonthlyTrend[];
  regions: Region[];
  alerts: Alert[];
  storage: {
    sqlite: string;
    duckdb: string;
    mongodb: string;
  };
};

type Section = 'overview' | 'territories' | 'integrations';

const numberFormat = new Intl.NumberFormat('pt-BR');

function formatNumber(value: number) {
  return numberFormat.format(value);
}

function formatChange(value: number) {
  return `${value > 0 ? '+' : ''}${value.toLocaleString('pt-BR', {
    maximumFractionDigits: 1,
  })}%`;
}

function Icon({
  name,
  size = 20,
}: {
  name: 'grid' | 'map' | 'layers' | 'search' | 'refresh' | 'arrow' | 'cloud' | 'heart' | 'database' | 'warning' | 'check' | 'external';
  size?: number;
}) {
  const paths: Record<typeof name, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" /><path d="M9 3v15M15 6v15" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2" /></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
    cloud: <><path d="M20 16.2A4.5 4.5 0 0 0 18 7.5a6 6 0 0 0-11.6 1A4 4 0 0 0 7 16h13Z" /><path d="m9 20 2-2 2 2 2-2" /></>,
    heart: <><path d="M20.8 8.7c0 4.2-8.8 10-8.8 10s-8.8-5.8-8.8-10A4.7 4.7 0 0 1 12 6a4.7 4.7 0 0 1 8.8 2.7Z" /><path d="M5 12h4l2-4 3 8 2-4h3" /></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
    warning: <><path d="m10.3 4.3-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-2.7l-8-14a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4m0 4h.01" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    external: <><path d="M14 3h7v7m0-7L10 14" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function TrendChart({ trend }: { trend: MonthlyTrend[] }) {
  const width = 620;
  const height = 220;
  const padding = { top: 16, right: 12, bottom: 34, left: 36 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maximum = Math.max(...trend.map((item) => item.cases), 1) * 1.16;
  const points = trend.map((item, index) => ({
    ...item,
    x: padding.left + (index / Math.max(trend.length - 1, 1)) * chartWidth,
    y: padding.top + chartHeight - (item.cases / maximum) * chartHeight,
  }));
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `${padding.left},${padding.top + chartHeight} ${line} ${padding.left + chartWidth},${padding.top + chartHeight}`;

  return (
    <div className="chart-wrap">
      <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Atendimentos respiratórios por mês">
        {[0, 1, 2, 3].map((lineIndex) => {
          const y = padding.top + (chartHeight / 3) * lineIndex;
          return <line key={lineIndex} x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="chart-grid" />;
        })}
        <polygon points={area} className="chart-area" />
        <polyline points={line} className="chart-line" />
        {points.map((point) => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} r="4" className="chart-point" />
            <text x={point.x} y={height - 8} textAnchor="middle" className="chart-label">{point.label}</text>
          </g>
        ))}
      </svg>
      <div className="chart-legend"><span className="legend-dot" /> Atendimentos respiratórios</div>
    </div>
  );
}

function App() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [section, setSection] = useState<Section>('overview');
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isImportingHop, setIsImportingHop] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const loadDashboard = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard');
      if (!response.ok) {
        throw new Error(`O servidor respondeu com erro ${response.status}.`);
      }
      setDashboard(await response.json() as DashboardData);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os dados.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const filteredRegions = useMemo(() => {
    if (!dashboard) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
    return dashboard.regions.filter((region) =>
      `${region.name} ${region.state}`.toLocaleLowerCase('pt-BR').includes(normalizedQuery),
    );
  }, [dashboard, query]);

  async function synchronizeData() {
    setIsSyncing(true);
    setFeedback('');
    try {
      const response = await fetch('/api/sync', { method: 'POST' });
      const result = await response.json() as DashboardData & { sync_warnings?: string[] };
      if (!response.ok) {
        throw new Error(result && 'detail' in result ? String(result.detail) : 'Falha ao atualizar os dados.');
      }
      setDashboard(result);
      setError('');
      setFeedback(result.sync_warnings?.length
        ? `Dados atualizados com ressalvas: ${result.sync_warnings.join(' ')}`
        : 'Dados externos atualizados e consolidados com sucesso.');
    } catch (syncError) {
      setFeedback(syncError instanceof Error ? syncError.message : 'Não foi possível atualizar os dados.');
    } finally {
      setIsSyncing(false);
    }
  }

  async function importHopData() {
    setIsImportingHop(true);
    setFeedback('');
    try {
      const response = await fetch('/api/import-hop', { method: 'POST' });
      const result = await response.json() as DashboardData & { sync_warnings?: string[]; detail?: string };
      if (!response.ok) {
        throw new Error(result.detail || 'Não foi possível importar a saída do Apache Hop.');
      }
      setDashboard(result);
      setError('');
      setFeedback(result.sync_warnings?.length
        ? `Arquivo do Hop integrado com ressalvas: ${result.sync_warnings.join(' ')}`
        : 'Arquivo do Apache Hop integrado aos bancos de dados.');
    } catch (importError) {
      setFeedback(importError instanceof Error ? importError.message : 'Não foi possível importar a saída do Apache Hop.');
    } finally {
      setIsImportingHop(false);
    }
  }

  const navItems: { id: Section; label: string; icon: 'grid' | 'map' | 'layers' }[] = [
    { id: 'overview', label: 'Visão geral', icon: 'grid' },
    { id: 'territories', label: 'Territórios', icon: 'map' },
    { id: 'integrations', label: 'Integrações', icon: 'layers' },
  ];

  const sectionTitles: Record<Section, string> = {
    overview: 'Visão geral',
    territories: 'Territórios monitorados',
    integrations: 'Central de dados',
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="VivaSaúde, início">
          <span className="brand-mark"><Icon name="heart" size={23} /></span>
          <span className="brand-copy"><strong>viva<span>saúde</span></strong><small>OBSERVATÓRIO</small></span>
        </a>

        <div className="workspace-label">ESPAÇO DE TRABALHO</div>
        <nav className="main-nav" aria-label="Navegação principal">
          {navItems.map((item) => (
            <button
              className={`nav-link ${section === item.id ? 'active' : ''}`}
              key={item.id}
              onClick={() => setSection(item.id)}
              type="button"
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
              {item.id === 'territories' && <span className="nav-count">04</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-icon"><Icon name="cloud" size={18} /></span>
            <strong>Saúde começa no território</strong>
            <p>Dados integrados para decisões públicas mais inteligentes.</p>
          </div>
          <div className="profile">
            <div className="avatar">VS</div>
            <div className="profile-copy"><strong>Equipe de saúde</strong><span>Gestão regional</span></div>
            <span className="online-dot" aria-label="Online" />
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>Observatório</span><span className="breadcrumb-separator">/</span><strong>{sectionTitles[section]}</strong></div>
          <div className="topbar-actions">
            <span className="live-indicator"><span className="live-dot" /> Monitoramento ativo</span>
            <button className="sync-button" onClick={() => void synchronizeData()} disabled={isSyncing} type="button">
              <Icon name="refresh" size={16} />
              {isSyncing ? 'Atualizando...' : 'Atualizar dados'}
            </button>
          </div>
        </header>

        <div className="page-content">
          <section className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-mark" /> SAÚDE PÚBLICA · ESTADO DE SÃO PAULO</div>
              <h1>{section === 'overview' ? <>Saúde que <span>antecipa.</span></> : sectionTitles[section]}</h1>
              <p className="page-subtitle">
                {section === 'overview' && 'Conectando qualidade do ar e atendimentos respiratórios para cuidar melhor de cada território.'}
                {section === 'territories' && 'Compare indicadores e sinais ambientais entre as regiões acompanhadas.'}
                {section === 'integrations' && 'Acompanhe as fontes, o fluxo de integração e a disponibilidade dos bancos de dados.'}
              </p>
            </div>
            <div className="period-chip"><span className="period-dot" /> ÚLTIMOS 7 MESES</div>
          </section>

          {dashboard && (
            <div className="data-notice"><Icon name="warning" size={16} /><span>{dashboard.data_notice}</span></div>
          )}
          {feedback && <div className="feedback-message" role="status">{feedback}</div>}
          {error && (
            <div className="error-card" role="alert">
              <span className="error-icon"><Icon name="warning" size={19} /></span>
              <div><strong>Não foi possível conectar ao serviço de dados.</strong><p>{error} Inicie a API seguindo as instruções do README e tente novamente.</p></div>
              <button type="button" className="text-button" onClick={() => { setIsLoading(true); void loadDashboard(); }}>Tentar novamente</button>
            </div>
          )}

          {isLoading && <div className="loading-card"><span className="spinner" /> Carregando indicadores do território...</div>}

          {dashboard && section === 'overview' && (
            <>
              <section className="metrics-grid" aria-label="Indicadores principais">
                <article className="metric-card metric-primary">
                  <div className="metric-topline"><span>ATENDIMENTOS RESPIRATÓRIOS</span><span className="metric-icon"><Icon name="heart" size={19} /></span></div>
                  <div className="metric-value">{formatNumber(dashboard.metrics.respiratory_visits)}</div>
                  <div className="metric-foot"><span className={`trend-pill ${dashboard.metrics.change_percent > 0 ? 'trend-up' : 'trend-down'}`}>{formatChange(dashboard.metrics.change_percent)} <Icon name="arrow" size={12} /></span><span>vs. mês anterior</span></div>
                </article>
                <article className="metric-card">
                  <div className="metric-topline"><span>MÉDIA DE PM2.5</span><span className="metric-icon air-icon"><Icon name="cloud" size={19} /></span></div>
                  <div className="metric-value">{dashboard.metrics.average_pm25.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}<small> µg/m³</small></div>
                  <div className="metric-foot"><span className="metric-caption">Material particulado no ar</span></div>
                </article>
                <article className="metric-card">
                  <div className="metric-topline"><span>TERRITÓRIOS MONITORADOS</span><span className="metric-icon area-icon"><Icon name="map" size={18} /></span></div>
                  <div className="metric-value">{String(dashboard.metrics.monitored_regions).padStart(2, '0')}<small> cidades</small></div>
                  <div className="metric-foot"><span className="metric-caption">Região de São Paulo</span></div>
                </article>
                <article className="metric-card">
                  <div className="metric-topline"><span>SINAIS DE ATENÇÃO</span><span className="metric-icon alert-icon"><Icon name="warning" size={19} /></span></div>
                  <div className="metric-value">{String(dashboard.metrics.alerts).padStart(2, '0')}<small> alertas</small></div>
                  <div className="metric-foot"><span className="alert-caption"><span className="alert-mini-dot" /> Requerem acompanhamento</span></div>
                </article>
              </section>

              <section className="overview-grid">
                <article className="panel trend-panel">
                  <div className="panel-heading">
                    <div><span className="panel-kicker">TENDÊNCIA DE SAÚDE</span><h2>Atendimentos respiratórios</h2><p>Volume mensal consolidado nas regiões monitoradas</p></div>
                    <span className="chart-period">7 meses <span>⌄</span></span>
                  </div>
                  <TrendChart trend={dashboard.monthly_trend} />
                </article>
                <article className="panel air-panel">
                  <div className="panel-heading">
                    <div><span className="panel-kicker">AMBIENTE</span><h2>Qualidade do ar</h2><p>PM2.5 mais recente por território</p></div>
                    <span className="air-unit">µg/m³</span>
                  </div>
                  <div className="air-list">
                    {dashboard.regions.map((region) => (
                      <div className="air-row" key={region.code}>
                        <div className="air-place"><span className="air-place-dot" /><span>{region.name}</span></div>
                        <div className="air-bar-track"><span className={`air-bar ${region.pm25 > 15 ? 'bar-high' : region.pm25 > 10 ? 'bar-mid' : ''}`} style={{ width: `${Math.min(region.pm25 / 25 * 100, 100)}%` }} /></div>
                        <strong className="air-value">{region.pm25.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="air-footnote"><span className="source-dot" /> Fonte: {dashboard.air_quality_source}</div>
                </article>
              </section>

              <section className="panel regions-panel">
                <div className="panel-heading regions-heading">
                  <div><span className="panel-kicker">VISÃO TERRITORIAL</span><h2>Regiões em acompanhamento</h2></div>
                  <button className="subtle-button" type="button" onClick={() => setSection('territories')}>Ver todos <Icon name="arrow" size={14} /></button>
                </div>
                <RegionTable regions={filteredRegions} query={query} setQuery={setQuery} />
              </section>
            </>
          )}

          {dashboard && section === 'territories' && (
            <section className="panel territories-panel">
              <div className="panel-heading regions-heading">
                <div><span className="panel-kicker">INDICADORES LOCAIS</span><h2>Panorama por município</h2><p>Os sinais são indicativos e não substituem avaliação epidemiológica.</p></div>
              </div>
              <RegionTable regions={filteredRegions} query={query} setQuery={setQuery} />
              <div className="territory-cards">
                {dashboard.regions.map((region) => (
                  <article className="territory-card" key={region.code}>
                    <span className={`status-dot status-${region.status.toLocaleLowerCase('pt-BR')}`} />
                    <span className="territory-card-name">{region.name}, {region.state}</span>
                    <strong>{region.risk_score}<small>/100</small></strong>
                    <span className="territory-card-label">Índice indicativo de atenção</span>
                  </article>
                ))}
              </div>
            </section>
          )}

          {dashboard && section === 'integrations' && (
            <section className="integration-layout">
              <article className="panel integration-panel">
                <div className="panel-heading"><div><span className="panel-kicker">PIPELINE DE DADOS</span><h2>Da fonte à decisão</h2><p>Extração, transformação e carga dos indicadores municipais.</p></div></div>
                <div className="pipeline">
                  <PipelineStep number="01" title="Fontes públicas" detail="Open-Meteo · qualidade do ar" icon="cloud" />
                  <span className="pipeline-connector" />
                  <PipelineStep number="02" title="Integração ETL" detail="Apache Hop · limpeza e agregação" icon="layers" />
                  <span className="pipeline-connector" />
                  <PipelineStep number="03" title="Armazenamento" detail="SQLite · DuckDB · MongoDB" icon="database" />
                  <span className="pipeline-connector" />
                  <PipelineStep number="04" title="Indicadores" detail="API Python · painel React" icon="grid" />
                </div>
                <div className="source-card"><div className="source-card-icon"><Icon name="cloud" size={19} /></div><div><strong>Open-Meteo Air Quality API</strong><p>Dados de PM2.5 e PM10 por localização, atualizados sob demanda.</p><a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noreferrer">Documentação da API <Icon name="external" size={13} /></a></div><span className="source-status"><span className="live-dot" /> API externa</span></div>
                <div className="source-card"><div className="source-card-icon health-source"><Icon name="heart" size={19} /></div><div><strong>Indicadores de saúde agregados</strong><p>Série demonstrativa sintética; substitua por fonte pública ou autorizada antes do uso real.</p><span className="synthetic-tag">DADOS DEMONSTRATIVOS</span></div></div>
              </article>
              <article className="panel storage-panel">
                <div className="panel-heading"><div><span className="panel-kicker">PERSISTÊNCIA POLIGLOTA</span><h2>Bancos conectados</h2><p>Três tecnologias, cada uma com seu papel.</p></div></div>
                <StorageCard name="SQLite" purpose="Dados operacionais e indicadores consolidados" status={dashboard.storage.sqlite} />
                <StorageCard name="DuckDB" purpose="Consultas analíticas e consolidação histórica" status={dashboard.storage.duckdb} />
                <StorageCard name="MongoDB" purpose="Arquivo flexível de respostas brutas da API" status={dashboard.storage.mongodb} />
                <button className="sync-wide-button" onClick={() => void synchronizeData()} disabled={isSyncing || isImportingHop} type="button"><Icon name="refresh" size={16} />{isSyncing ? 'Sincronizando fontes...' : 'Atualizar pela API Python'}</button>
                <button className="hop-import-button" onClick={() => void importHopData()} disabled={isSyncing || isImportingHop} type="button"><Icon name="layers" size={15} />{isImportingHop ? 'Importando arquivo...' : 'Importar saída do Hop'}</button>
                <p className="last-sync">Última atualização: {dashboard.last_sync ? new Date(dashboard.last_sync).toLocaleString('pt-BR') : 'ainda não executada'}</p>
              </article>
            </section>
          )}

          {dashboard && section === 'overview' && (
            <section className="bottom-grid">
              <article className="panel alerts-panel">
                <div className="panel-heading alerts-heading"><div><span className="panel-kicker">ACOMPANHAMENTO</span><h2>Sinais no território</h2></div><span className="alerts-count">{dashboard.alerts.length} ativos</span></div>
                {dashboard.alerts.length === 0 ? <p className="empty-alerts"><Icon name="check" size={16} /> Nenhum sinal acima dos limites indicativos neste momento.</p> : (
                  <div className="alerts-list">{dashboard.alerts.slice(0, 3).map((alert) => (
                    <div className="alert-row" key={alert.id}>
                      <span className={`alert-symbol ${alert.level === 'Alto' ? 'alert-symbol-high' : ''}`}><Icon name="warning" size={17} /></span>
                      <div><strong>{alert.title}</strong><p>{alert.description}</p></div>
                      <span className="alert-location">{alert.region}</span>
                    </div>
                  ))}</div>
                )}
              </article>
              <article className="insight-card">
                <span className="insight-orb"><Icon name="heart" size={21} /></span>
                <span className="panel-kicker">POR QUE ISSO IMPORTA</span>
                <h2>Ambiente e saúde, lado a lado.</h2>
                <p>Observar partículas no ar junto com a procura por atendimento ajuda equipes a identificar onde investigar primeiro.</p>
                <span className="insight-foot">Uma ferramenta de apoio — não de diagnóstico.</span>
              </article>
            </section>
          )}

          <footer className="page-footer"><span>VivaSaúde <span className="footer-dot">·</span> Observatório de saúde territorial</span><span>Dados agregados, sem identificação pessoal <span className="privacy-shield">◆</span></span></footer>
        </div>
      </main>
    </div>
  );
}

function RegionTable({
  regions,
  query,
  setQuery,
}: {
  regions: Region[];
  query: string;
  setQuery: (value: string) => void;
}) {
  return (
    <div className="table-container">
      <div className="table-toolbar">
        <span className="table-caption">{regions.length} municípios monitorados</span>
        <label className="search-field"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar município..." aria-label="Buscar município" /></label>
      </div>
      <table>
        <thead><tr><th>MUNICÍPIO</th><th>ATENDIMENTOS</th><th>PM2.5</th><th>VARIAÇÃO</th><th>ÍNDICE DE ATENÇÃO</th><th>STATUS</th></tr></thead>
        <tbody>
          {regions.map((region) => (
            <tr key={region.code}>
              <td><span className="municipality"><span className="municipality-avatar">{region.name.slice(0, 1)}</span><span><strong>{region.name}</strong><small>{region.state} · Pop. {formatNumber(region.population)}</small></span></span></td>
              <td className="numeric-cell">{formatNumber(region.cases)}</td>
              <td className="numeric-cell">{region.pm25.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} <span className="table-unit">µg/m³</span></td>
              <td><span className={`table-change ${region.change_percent > 0 ? 'change-up' : 'change-down'}`}>{formatChange(region.change_percent)}</span></td>
              <td><div className="risk-cell"><span className="risk-track"><span className={`risk-fill risk-${region.status.toLocaleLowerCase('pt-BR')}`} style={{ width: `${region.risk_score}%` }} /></span><strong>{region.risk_score}</strong></div></td>
              <td><span className={`status-badge status-${region.status.toLocaleLowerCase('pt-BR')}`}><span className="status-dot" />{region.status}</span></td>
            </tr>
          ))}
          {regions.length === 0 && <tr><td className="no-results" colSpan={6}>Nenhum município encontrado para “{query}”.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function PipelineStep({
  number,
  title,
  detail,
  icon,
}: {
  number: string;
  title: string;
  detail: string;
  icon: 'cloud' | 'layers' | 'database' | 'grid';
}) {
  return <div className="pipeline-step"><span className="pipeline-number">{number}</span><span className="pipeline-icon"><Icon name={icon} size={20} /></span><strong>{title}</strong><span className="pipeline-detail">{detail}</span></div>;
}

function StorageCard({ name, purpose, status }: { name: string; purpose: string; status: string }) {
  const connected = status === 'connected';
  return (
    <div className="storage-card">
      <span className="storage-db-icon"><Icon name="database" size={18} /></span>
      <div className="storage-card-copy"><strong>{name}</strong><span>{purpose}</span></div>
      <span className={`storage-status ${connected ? 'connected' : 'disconnected'}`}><span />{connected ? 'Conectado' : 'Indisponível'}</span>
    </div>
  );
}

export default App;
