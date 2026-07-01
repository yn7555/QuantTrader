import { create } from 'zustand'
import request from '@/common/utils/request'
import type {
  StockOption,
  StrategyOption,
  VirtualAccountOption,
  TimeFrame,
  ReplaySession,
  ReplayMetrics,
  KlineBar,
  TradeSignal,
  TradeRecord,
  EquityPoint,
  ReplayStatus,
  BenchmarkPoint,
  StrategyReturnPoint,
  DailyPnlPoint,
  DailyPositionPoint,
  ReplayLogEntry,
  ReportTab,
} from '../types'

// === 回测配置状态 ===

interface ReplayConfigState {
  stockCode: string
  stockName: string
  strategyId: number | null
  accountId: number | null
  timeframe: TimeFrame
  startDate: string
  endDate: string
  setStockCode: (code: string, name: string) => void
  setStrategyId: (id: number) => void
  setAccountId: (id: number) => void
  setTimeframe: (tf: TimeFrame) => void
  setStartDate: (d: string) => void
  setEndDate: (d: string) => void
  resetConfig: () => void
}

const initialConfig = {
  stockCode: '',
  stockName: '',
  strategyId: null as number | null,
  accountId: null as number | null,
  timeframe: '1d' as TimeFrame,
  startDate: '2024-01-01',
  endDate: '2024-12-31',
}

export const useReplayConfig = create<ReplayConfigState>((set) => ({
  ...initialConfig,
  setStockCode: (code, name) => set({ stockCode: code, stockName: name }),
  setStrategyId: (id) => set({ strategyId: id }),
  setAccountId: (id) => set({ accountId: id }),
  setTimeframe: (tf) => set({ timeframe: tf }),
  setStartDate: (d) => set({ startDate: d }),
  setEndDate: (d) => set({ endDate: d }),
  resetConfig: () => set(initialConfig),
}))

// === 回测运行时状态 ===

interface ReplayRuntimeState {
  sessionId: number | null
  status: ReplayStatus
  currentIndex: number
  totalBars: number
  speed: 1 | 2 | 4 | 8

  // 回测数据
  klineData: KlineBar[]
  signals: TradeSignal[]
  trades: TradeRecord[]
  metrics: ReplayMetrics | null
  equityCurve: EquityPoint[]

  // 报告视图数据
  benchmarkData: BenchmarkPoint[]
  strategyReturnData: StrategyReturnPoint[]
  dailyPnlData: DailyPnlPoint[]
  dailyPositionData: DailyPositionPoint[]
  logEntries: ReplayLogEntry[]

  // 报告视图状态
  reportTab: ReportTab

  // 加载状态
  loading: boolean

  // Actions
  startReplay: () => Promise<void>
  controlReplay: (action: 'pause' | 'resume' | 'stop') => Promise<void>
  setSpeed: (speed: 1 | 2 | 4 | 8) => Promise<void>
  fetchSessionData: (sessionId: number) => Promise<void>
  fetchReportData: (sessionId: number) => Promise<void>
  setReportTab: (tab: ReportTab) => void
  reset: () => void
}

const initialRuntime = {
  sessionId: null,
  status: 'idle' as ReplayStatus,
  currentIndex: 0,
  totalBars: 0,
  speed: 1 as const,
  klineData: [] as KlineBar[],
  signals: [] as TradeSignal[],
  trades: [] as TradeRecord[],
  metrics: null as ReplayMetrics | null,
  equityCurve: [] as EquityPoint[],
  benchmarkData: [] as BenchmarkPoint[],
  strategyReturnData: [] as StrategyReturnPoint[],
  dailyPnlData: [] as DailyPnlPoint[],
  dailyPositionData: [] as DailyPositionPoint[],
  logEntries: [] as ReplayLogEntry[],
  reportTab: 'overview' as ReportTab,
  loading: false,
}

export const useReplayRuntime = create<ReplayRuntimeState>((set, get) => ({
  ...initialRuntime,

  startReplay: async () => {
    const config = useReplayConfig.getState()
    set({ loading: true })
    try {
      // 拦截器已解包，request.post 直接返回业务数据
      const session = await request.post<ReplaySession>('/replay/start', {
        stock_code: config.stockCode,
        strategy_id: config.strategyId,
        account_id: config.accountId,
        timeframe: config.timeframe,
        start_date: config.startDate,
        end_date: config.endDate,
      })
      if (session) {
        set({
          sessionId: session.session_id,
          status: session.status,
          totalBars: session.total_bars,
          loading: false,
        })
        // 启动后拉取全部回测数据
        await get().fetchSessionData(session.session_id)
        // 如果已直接完成（stub 情况），也拉取报告数据
        if (session.status === 'completed') {
          await get().fetchReportData(session.session_id)
        }
      }
    } catch {
      set({ status: 'error', loading: false })
    }
  },

  controlReplay: async (action) => {
    const { sessionId } = get()
    if (!sessionId) return
    try {
      const data = await request.post<ReplaySession>('/replay/control', {
        session_id: sessionId,
        action,
      })
      if (data) {
        const newStatus = data.status
        set({ status: newStatus })
        // 如果停止后变为完成状态，拉取报告数据
        if (newStatus === 'completed') {
          await get().fetchReportData(sessionId)
        }
      }
    } catch {
      set({ status: 'error' })
    }
  },

  setSpeed: async (speed) => {
    const { sessionId } = get()
    if (!sessionId) return
    try {
      await request.post('/replay/speed', {
        session_id: sessionId,
        speed,
      })
      set({ speed })
    } catch {
      // 静默失败
    }
  },

  fetchSessionData: async (sessionId) => {
    try {
      const [klineData, signalsData, tradesData, metricsData, equityData] = await Promise.all([
        request.get<KlineBar[]>(`/replay/kline/${sessionId}`),
        request.get<TradeSignal[]>(`/replay/signals/${sessionId}`),
        request.get<TradeRecord[]>(`/replay/trades/${sessionId}`),
        request.get<ReplayMetrics>(`/replay/metrics/${sessionId}`),
        request.get<EquityPoint[]>(`/replay/equity/${sessionId}`),
      ])
      set({
        klineData: Array.isArray(klineData) ? klineData : [],
        signals: Array.isArray(signalsData) ? signalsData : [],
        trades: Array.isArray(tradesData) ? tradesData : [],
        metrics: metricsData ?? null,
        equityCurve: Array.isArray(equityData) ? equityData : [],
      })
    } catch {
      // 数据拉取失败不改变状态
    }
  },

  fetchReportData: async (sessionId) => {
    try {
      const [benchmarkData, returnData, pnlData, positionData, logsData] = await Promise.all([
        request.get<BenchmarkPoint[]>(`/replay/benchmark/${sessionId}`),
        request.get<StrategyReturnPoint[]>(`/replay/strategy-return/${sessionId}`),
        request.get<DailyPnlPoint[]>(`/replay/daily-pnl/${sessionId}`),
        request.get<DailyPositionPoint[]>(`/replay/daily-positions/${sessionId}`),
        request.get<ReplayLogEntry[]>(`/replay/logs/${sessionId}`),
      ])
      set({
        benchmarkData: Array.isArray(benchmarkData) ? benchmarkData : [],
        strategyReturnData: Array.isArray(returnData) ? returnData : [],
        dailyPnlData: Array.isArray(pnlData) ? pnlData : [],
        dailyPositionData: Array.isArray(positionData) ? positionData : [],
        logEntries: Array.isArray(logsData) ? logsData : [],
      })
    } catch {
      // 数据拉取失败不改变状态
    }
  },

  setReportTab: (tab) => set({ reportTab: tab }),

  reset: () => set(initialRuntime),
}))

// === 下拉选项数据 ===

interface ReplayOptionsState {
  stocks: StockOption[]
  strategies: StrategyOption[]
  accounts: VirtualAccountOption[]
  fetchStrategies: () => Promise<void>
  fetchAccounts: () => Promise<void>
  searchStocks: (keyword: string) => Promise<void>
}

export const useReplayOptions = create<ReplayOptionsState>((set) => ({
  stocks: [],
  strategies: [],
  accounts: [],

  fetchStrategies: async () => {
    try {
      // 拦截器已解包，request.get 直接返回业务数据数组
      const data = await request.get<StrategyOption[]>('/replay/strategies')
      set({ strategies: Array.isArray(data) ? data : [] })
    } catch { /* noop */ }
  },

  fetchAccounts: async () => {
    try {
      const data = await request.get<VirtualAccountOption[]>('/replay/virtual-accounts')
      set({ accounts: Array.isArray(data) ? data : [] })
    } catch { /* noop */ }
  },

  searchStocks: async (keyword: string) => {
    if (!keyword.trim()) {
      set({ stocks: [] })
      return
    }
    try {
      const data = await request.post<StockOption[]>('/replay/stocks/search', {
        keyword,
        limit: 10,
      })
      set({ stocks: Array.isArray(data) ? data : [] })
    } catch { /* noop */ }
  },
}))
