import React, { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { candidateJudgement, type CandidateStatus, type Observation, type ObservationStatus } from './mock-data'
import { TraceMap } from './TraceMap'

type TracePanelProps = {
  observations: Observation[]
  focusedObservationId?: string
  onAccept: (text: string, source?: string) => void
  candidateStatus: CandidateStatus
  onCandidateAction: (status: CandidateStatus) => void
  onContinue: () => void
  onClose: () => void
  onToggleSize: () => void
  discussionNotice: string
  onHeaderPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void
  onHeaderPointerMove?: (event: ReactPointerEvent<HTMLElement>) => void
  onHeaderPointerUp?: (event: ReactPointerEvent<HTMLElement>) => void
  compact?: boolean
  capabilities?: any
  onCapabilityRequest?: (request: Record<string, unknown>) => Promise<any>
}

const statusClass: Record<ObservationStatus, string> = {
  待确认: 'pending',
  候选中: 'candidate',
  已采用: 'adopted',
  需回顾: 'review',
  已暂存: 'stored',
  已拒绝: 'rejected',
}

const candidateStatusClass: Record<CandidateStatus, string> = {
  候选中: 'candidate',
  已采用: 'adopted',
  已暂存: 'stored',
  已拒绝: 'rejected',
}

export function TracePanel({
  observations,
  focusedObservationId,
  onAccept,
  candidateStatus,
  onCandidateAction,
  onContinue,
  onClose,
  onToggleSize,
  discussionNotice,
  onHeaderPointerDown,
  onHeaderPointerMove,
  onHeaderPointerUp,
  compact = false,
  capabilities,
  onCapabilityRequest,
}: TracePanelProps) {
  const [draft, setDraft] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [imagePreview, setImagePreview] = useState<{ url: string; name: string } | null>(null)
  const [sourceMode, setSourceMode] = useState<'zhihu' | 'global'>('zhihu')
  const [profileId, setProfileId] = useState('')
  const [capabilityBusy, setCapabilityBusy] = useState<'search' | 'agent' | ''>('')
  const [capabilityNotice, setCapabilityNotice] = useState('')
  const [sourceResults, setSourceResults] = useState<any[]>([])
  const [agentRun, setAgentRun] = useState<any>(null)
  const focusedCardRef = useRef<HTMLElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const recordingTimerRef = useRef<number | undefined>(undefined)
  const focusedObservation = observations.find((observation) => observation.id === focusedObservationId)
  const agent = capabilities?.agent
  const profiles = agent?.profiles || []
  const sourceMetric = (item: any) => [
    Number.isSafeInteger(item.vote_up_count) ? `${item.vote_up_count} 赞同` : '',
    Number.isSafeInteger(item.comment_count) ? `${item.comment_count} 评论` : '',
    item.content_type || '',
  ].filter(Boolean).join(' · ')

  useEffect(() => {
    if (!profileId && (agent?.defaultProfileId || profiles[0]?.profileId)) setProfileId(agent?.defaultProfileId || profiles[0].profileId)
  }, [agent?.defaultProfileId, profiles.length, profileId])

  useEffect(() => {
    if (!focusedObservationId) return
    focusedCardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedObservationId])

  useEffect(() => () => {
    if (recordingTimerRef.current !== undefined) window.clearTimeout(recordingTimerRef.current)
    if (imagePreview) URL.revokeObjectURL(imagePreview.url)
  }, [imagePreview])

  const clearImagePreview = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview.url)
    setImagePreview(null)
  }

  const startMockRecording = () => {
    if (isRecording) return
    setIsRecording(true)
    recordingTimerRef.current = window.setTimeout(() => {
      setDraft('刚才在协作里发现：先保留证据和待回答问题，比立刻总结更重要。')
      setIsRecording(false)
      recordingTimerRef.current = undefined
    }, 2000)
  }

  const selectImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    clearImagePreview()
    setImagePreview({ url: URL.createObjectURL(file), name: file.name })
    event.target.value = ''
  }

  const submitObservation = () => {
    const text = draft.trim()
    if (!text) return
    onAccept(text)
    setDraft('')
    clearImagePreview()
  }

  const capabilityText = () => draft.trim() || focusedObservation?.text || ''
  const search = async () => {
    const text = capabilityText()
    if (!text || !onCapabilityRequest) { setCapabilityNotice('先写一句，或打开一条历史观察。'); return }
    setCapabilityBusy('search'); setCapabilityNotice(`正在${sourceMode === 'zhihu' ? '知乎' : '全网'}搜索…`); setSourceResults([])
    try {
      const value = await onCapabilityRequest({ operation: 'search', source: sourceMode, query: text, count: 3 })
      setSourceResults(value.items || []); setCapabilityNotice(value.items?.length ? `收到 ${value.items.length} 条接口摘要，尚未保存。` : '本次没有返回来源。')
    } catch (error) { setCapabilityNotice(error instanceof Error ? error.message : String(error)) }
    finally { setCapabilityBusy('') }
  }
  const runAgent = async () => {
    const text = capabilityText()
    if (!text || !onCapabilityRequest) { setCapabilityNotice('先写一句，或打开一条历史观察。'); return }
    setCapabilityBusy('agent'); setCapabilityNotice('正在创建一次有边界的 Agent 运行…'); setAgentRun(null)
    try {
      const value = await onCapabilityRequest({ operation: 'agent.run', text, source: sourceMode, ...(profileId ? { profileId } : {}) })
      setAgentRun(value); setCapabilityNotice(value.status === 'succeeded' ? 'Agent 已返回候选，没有自动改写理解。' : value.error?.message || `本次运行：${value.status}`)
    } catch (error) { setCapabilityNotice(error instanceof Error ? error.message : String(error)) }
    finally { setCapabilityBusy('') }
  }

  return (
    <aside className={`trace-panel ${compact ? 'trace-panel-compact' : ''}`} aria-label="Trace 思考沉淀面板">
      <header
        className="trace-panel-header trace-panel-drag-handle"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
        <div>
          <span className="trace-eyebrow">TRACE · THINKING LAYER</span>
          <h2>先接住，再想清楚</h2>
          <p>不用现在分类，先把现场留在这里。</p>
        </div>
        <div className="trace-panel-window-actions" onPointerDown={(event) => event.stopPropagation()}>
          <button className="trace-panel-size-button" type="button" onClick={onToggleSize} aria-label={compact ? '展开为大悬浮窗' : '缩为小悬浮窗'}>
            <span aria-hidden="true">{compact ? '展开' : '缩小'}</span>
          </button>
          <button className="trace-icon-button" type="button" onClick={onClose} aria-label="返回气泡视图">
            ×
          </button>
        </div>
      </header>

      <section className="trace-section trace-capture-section">
        <label className="trace-label" htmlFor="trace-capture-input">此刻想留下什么？</label>
        <div className="trace-capture-input-row">
          <textarea
            id="trace-capture-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="看到的现象、踩到的坑、突然想通的判断……"
            rows={3}
          />
          <div className="trace-capture-media-actions" aria-label="轻接收方式">
            <button className={`trace-media-button ${isRecording ? 'trace-media-button-recording' : ''}`} type="button" onClick={startMockRecording} aria-label="模拟语音输入" title="模拟语音输入">
              {isRecording ? <span className="trace-recording-wave" aria-label="正在录音"><i /><i /><i /><i /></span> : '◉'}
            </button>
            <button className="trace-media-button" type="button" onClick={() => imageInputRef.current?.click()} aria-label="选择图片" title="选择图片">
              ▧
            </button>
            <input ref={imageInputRef} className="trace-file-input" type="file" accept="image/*" onChange={selectImage} />
          </div>
        </div>
        {isRecording && <p className="trace-recording-label">正在模拟录音，2 秒后将填入转写文本…</p>}
        {imagePreview && (
          <div className="trace-image-preview">
            <img src={imagePreview.url} alt="待接住的图片缩略图" />
            <div>
              <strong>图片现场已接住</strong>
              <span>Mock 识别：一张与当前思考有关的现场截图</span>
              <small>{imagePreview.name}</small>
            </div>
            <button type="button" onClick={clearImagePreview} aria-label="移除图片">×</button>
          </div>
        )}
        <div className="trace-action-row">
          <button className="trace-button trace-button-primary" type="button" onClick={submitObservation}>
            接住它
          </button>
          <button className="trace-button trace-button-secondary" type="button" onClick={onContinue}>
            继续讨论
          </button>
        </div>
        {discussionNotice && <p className="trace-inline-notice">{discussionNotice}</p>}
        <section className="trace-runtime-tools" aria-label="知乎与 Agent 能力">
          <div className="trace-runtime-heading"><div><span className="trace-eyebrow">LIVE CAPABILITIES</span><strong>让来源和 Agent 参与</strong></div><span className={capabilities?.connected ? 'trace-runtime-online' : 'trace-runtime-offline'}>{capabilities?.loading ? '检查中' : capabilities?.connected ? 'Runtime 已连接' : '未连接'}</span></div>
          <div className="trace-runtime-controls"><select aria-label="搜索范围" value={sourceMode} disabled={Boolean(capabilityBusy)} onChange={(event) => setSourceMode(event.target.value as 'zhihu' | 'global')}><option value="zhihu">知乎搜索</option><option value="global">全网搜索</option></select>{profiles.length > 0 && <select aria-label="Agent 执行器" value={profileId} disabled={Boolean(capabilityBusy)} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((profile: any) => <option key={profile.profileId} value={profile.profileId}>{profile.label || profile.profileId}</option>)}</select>}</div>
          <div className="trace-action-row"><button className="trace-button trace-button-secondary" type="button" disabled={!capabilities?.search?.enabled || Boolean(capabilityBusy)} onClick={() => void search()}>{capabilityBusy === 'search' ? '正在搜索…' : '查找来源'}</button><button className="trace-button trace-button-primary" type="button" disabled={!agent?.enabled || Boolean(capabilityBusy)} onClick={() => void runAgent()}>{capabilityBusy === 'agent' ? 'Agent 处理中…' : '交给 Agent'}</button></div>
          {!capabilities?.connected && <small>{capabilities?.error?.message || '启动 trace-runtime，并设置 TRACE_ZHIHU_ENABLED=1 与 TRACE_AGENT_ENABLED=1。'}</small>}
          {capabilities?.connected && !capabilities?.search?.enabled && <small>{capabilities?.search?.error?.message || '本机 Runtime 尚未启用知乎公开搜索。'}</small>}
          {capabilities?.connected && !agent?.enabled && <small>{agent?.error?.message || '本机 Runtime 尚未启用 Agent 执行器。'}</small>}
          {capabilityNotice && <p className="trace-runtime-notice" role="status">{capabilityNotice}</p>}
          {sourceResults.map((item) => <article className="trace-runtime-result" key={item.id}><small>{item.source === 'zhihu' ? '知乎公开内容' : '全网公开内容'}{item.author ? ` · ${item.author}` : ''}</small><strong>{item.title || '未命名来源'}</strong>{sourceMetric(item) && <span>{sourceMetric(item)}</span>}<p>{item.excerpt}</p><footer>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">查看原文</a> : <small>缺少原文链接</small>}<button type="button" onClick={() => onAccept(item.excerpt, item.source === 'zhihu' ? '知乎公开内容' : '全网公开内容')}>保留为观察</button></footer></article>)}
          {agentRun?.result && <article className="trace-runtime-result trace-runtime-agent"><small>{agentRun.profile?.label || 'Agent'} · 未采纳候选</small><strong>Agent 的回答</strong><p>{agentRun.result.answer}</p><button type="button" onClick={() => onAccept(agentRun.result.answer, agentRun.profile?.label || 'Trace Agent')}>保留为观察</button></article>}
        </section>
      </section>

      {compact && focusedObservation && (
        <article className="trace-compact-observation" aria-label="当前观察详情">
          <span className={`trace-status trace-status-${statusClass[focusedObservation.status]}`}>{focusedObservation.status}</span>
          <strong>{focusedObservation.text}</strong>
          <small>置信度 {focusedObservation.confidence}% · {focusedObservation.createdAt}</small>
        </article>
      )}

      <section className="trace-section" aria-labelledby="trace-history-title">
        <div className="trace-section-heading">
          <div>
            <span className="trace-eyebrow">现场回收站</span>
            <h3 id="trace-history-title">历史观察</h3>
          </div>
          <span className="trace-count">{observations.length} 条</span>
        </div>
        <div className="trace-observation-list">
          {observations.map((observation) => (
            <article
              className={`trace-observation-card ${observation.id === focusedObservationId ? 'trace-observation-card-focused' : ''}`}
              key={observation.id}
              ref={observation.id === focusedObservationId ? focusedCardRef : undefined}
              data-trace-observation-id={observation.id}
            >
              <div className="trace-observation-main">
                <p>{observation.text}</p>
                <div className="trace-meta-row">
                  <span className={`trace-status trace-status-${statusClass[observation.status]}`}>{observation.status}</span>
                  <span>置信度 {observation.confidence}%</span>
                  {observation.source && <span>来源 {observation.source}</span>}
                </div>
              </div>
              <time>{observation.createdAt}</time>
            </article>
          ))}
        </div>
      </section>

      <TraceMap />

      <section className="trace-section trace-candidate-section" aria-labelledby="trace-candidate-title">
        <div className="trace-section-heading">
          <div>
            <span className="trace-eyebrow">待你确认</span>
            <h3 id="trace-candidate-title">候选判断</h3>
          </div>
          <div className="trace-candidate-heading-meta">
            <span className={`trace-status trace-status-${candidateStatusClass[candidateStatus]}`}>{candidateStatus}</span>
            <span className="trace-confidence">{candidateJudgement.confidence}%</span>
          </div>
        </div>
        <div className="trace-candidate-card">
          <strong>{candidateJudgement.title}</strong>
          <p>{candidateJudgement.body}</p>
          <p className="trace-candidate-link">同步历史卡片：检索结果必须附带可追溯证据</p>
          <div className="trace-action-row trace-candidate-actions">
            <button className={`trace-button trace-button-primary ${candidateStatus === '已采用' ? 'trace-button-selected' : ''}`} type="button" onClick={() => onCandidateAction('已采用')}>
              采用
            </button>
            <button className={`trace-button trace-button-secondary ${candidateStatus === '已暂存' ? 'trace-button-selected' : ''}`} type="button" onClick={() => onCandidateAction('已暂存')}>
              暂存
            </button>
            <button className={`trace-button trace-button-quiet ${candidateStatus === '已拒绝' ? 'trace-button-selected' : ''}`} type="button" onClick={() => onCandidateAction('已拒绝')}>
              拒绝
            </button>
          </div>
        </div>
      </section>

      <p className="trace-footer-note">本地观察仍按当前会话保存；知乎搜索与 Agent 运行来自已连接的 Trace Runtime。</p>
    </aside>
  )
}
