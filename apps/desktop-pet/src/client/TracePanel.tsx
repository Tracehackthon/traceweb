import React, { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { type Observation, type ObservationStatus } from './mock-data'
import { type PetProjection, type TraceCodexApprovalDecision } from './codex-events'

type TracePanelProps = {
  observations: Observation[]
  focusedObservationId?: string
  onAccept: (text: string, source?: string) => void | Promise<void>
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
  codexProjection?: PetProjection
  onCodexDecision?: (decision: TraceCodexApprovalDecision) => Promise<void>
  onCodexInput?: (answers: Record<string, { answers: string[] }>) => Promise<void>
  codexInteractionBusy?: boolean
  codexInteractionNotice?: string
}

const statusClass: Record<ObservationStatus, string> = {
  待确认: 'pending',
  候选中: 'candidate',
  已采用: 'adopted',
  需回顾: 'review',
  已暂存: 'stored',
  已拒绝: 'rejected',
}

export function TracePanel({
  observations,
  focusedObservationId,
  onAccept,
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
  codexProjection,
  onCodexDecision,
  onCodexInput,
  codexInteractionBusy = false,
  codexInteractionNotice = '',
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
  const [codexAnswers, setCodexAnswers] = useState<Record<string, string>>({})
  const focusedCardRef = useRef<HTMLElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const recordingTimerRef = useRef<number | undefined>(undefined)
  const focusedObservation = observations.find((observation) => observation.id === focusedObservationId)
  const pendingCodexInteraction = codexProjection?.pendingInteraction
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

  useEffect(() => {
    setCodexAnswers({})
  }, [pendingCodexInteraction?.interactionId])

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

  const submitObservation = async () => {
    const text = draft.trim()
    if (!text) return
    try {
      await onAccept(text)
      setDraft('')
      clearImagePreview()
    } catch (error) {
      setCapabilityNotice(error instanceof Error ? error.message : '这条内容暂时没有保存成功。')
    }
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

  const submitCodexInput = () => {
    const answers: Record<string, { answers: string[] }> = {}
    for (const [id, answer] of Object.entries(codexAnswers)) {
      const trimmed = answer.trim()
      if (trimmed) answers[id] = { answers: [trimmed] }
    }
    if (!Object.keys(answers).length) return
    void onCodexInput?.(answers)
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

      {pendingCodexInteraction && (
        <section className="trace-section trace-approval-section" aria-labelledby="trace-approval-title" data-trace-interactive-region="approval">
          <div className="trace-approval-kicker">需要你的决定 · {pendingCodexInteraction.kind === 'input' ? '输入请求' : '操作请求'}</div>
          <h3 id="trace-approval-title">{pendingCodexInteraction.title}</h3>
          <p className="trace-approval-summary">{pendingCodexInteraction.summary}</p>
          <div className="trace-approval-impact">
            <span>将要发生什么</span>
            <strong>{pendingCodexInteraction.impact}</strong>
          </div>
          {pendingCodexInteraction.kind === 'input' ? (
            <>
              <p className="trace-approval-note">这次请求需要回答 Codex 的问题。Trace 只展示安全的问题摘要，不会猜测选项或代填答案。</p>
              {pendingCodexInteraction.questions?.length ? (
                <div className="trace-input-questions" aria-label="Codex 输入问题">
                  {pendingCodexInteraction.questions.map((question) => (
                    <label className="trace-input-question" key={question.id}>
                      <span>{question.header || '需要回答的问题'}</span>
                      <small>{question.question || '请填写你的回答'}</small>
                      <input
                        type={question.isSecret ? 'password' : 'text'}
                        value={codexAnswers[question.id] || ''}
                        onChange={(event) => setCodexAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                        placeholder={question.isSecret ? '不会在 Trace 界面回显' : '填写回答'}
                        autoComplete={question.isSecret ? 'off' : 'on'}
                      />
                    </label>
                  ))}
                </div>
              ) : (
                <p className="trace-approval-disabled">当前请求没有可安全展示的问题，Trace 不会猜测输入格式。</p>
              )}
            </>
          ) : (
            <p className="trace-approval-note">默认不会放行。允许只作用于这一次请求；拒绝当前操作不会代替 Agent 停止，若要中断本轮请明确选择“停止本轮”。</p>
          )}
          {codexInteractionNotice && <p className="trace-approval-notice" role="status">{codexInteractionNotice}</p>}
          {pendingCodexInteraction.kind === 'input' ? (
            <div className="trace-approval-actions">
              <button
                className="trace-button trace-button-primary"
                type="button"
                disabled={codexInteractionBusy || !onCodexInput || !pendingCodexInteraction.recoverable || !Object.values(codexAnswers).some((answer) => answer.trim())}
                onClick={submitCodexInput}
              >
                {codexInteractionBusy ? '正在提交…' : '提交回答'}
              </button>
              <button
                className="trace-button trace-button-secondary trace-approval-reject"
                type="button"
                disabled={codexInteractionBusy || !onCodexDecision || !pendingCodexInteraction.recoverable}
                onClick={() => void onCodexDecision?.('cancel')}
              >
                停止本轮
              </button>
            </div>
          ) : (
            <div className="trace-approval-actions">
              <button
                className="trace-button trace-button-secondary trace-approval-reject"
                type="button"
                disabled={codexInteractionBusy || !onCodexDecision || !pendingCodexInteraction.recoverable}
                onClick={() => void onCodexDecision?.('decline')}
              >
                {codexInteractionBusy ? '正在提交…' : '拒绝此操作'}
              </button>
              <button
                className="trace-button trace-button-quiet trace-approval-cancel"
                type="button"
                disabled={codexInteractionBusy || !onCodexDecision || !pendingCodexInteraction.recoverable}
                onClick={() => void onCodexDecision?.('cancel')}
              >
                停止本轮
              </button>
              <button
                className="trace-button trace-button-primary"
                type="button"
                disabled={codexInteractionBusy || !onCodexDecision || !pendingCodexInteraction.recoverable}
                onClick={() => void onCodexDecision?.('accept')}
              >
                允许这一次
              </button>
            </div>
          )}
          {!pendingCodexInteraction.recoverable && (
            <p className="trace-approval-disabled" role="status">
              {pendingCodexInteraction.state === 'expired'
                ? '这条请求已经过期，Trace 不会继续提交。请重新触发当前 Codex 操作。'
                : pendingCodexInteraction.state === 'conflict'
                  ? '这条请求的运行版本已经变化，请刷新当前 Codex 状态后再决定。'
                  : '这条请求当前不可恢复，Trace 不会猜测或重复提交。'}
            </p>
          )}
          {!pendingCodexInteraction.runId && <small className="trace-approval-disabled">这条请求缺少可恢复的运行身份，Trace 不会猜测目标。</small>}
        </section>
      )}

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
          <button className="trace-button trace-button-primary" type="button" onClick={() => void submitObservation()}>
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
          {sourceResults.map((item) => <article className="trace-runtime-result" key={item.id}><small>{item.source === 'zhihu' ? '知乎公开内容' : '全网公开内容'}{item.author ? ` · ${item.author}` : ''}</small><strong>{item.title || '未命名来源'}</strong>{sourceMetric(item) && <span>{sourceMetric(item)}</span>}<p>{item.excerpt}</p><footer>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">查看原文</a> : <small>缺少原文链接</small>}<button type="button" onClick={() => void onAccept(item.excerpt, item.source === 'zhihu' ? '知乎公开内容' : '全网公开内容')}>保留到 Trace</button></footer></article>)}
          {agentRun?.result && <article className="trace-runtime-result trace-runtime-agent"><small>{agentRun.profile?.label || 'Agent'} · 未采纳候选</small><strong>Agent 的回答</strong><p>{agentRun.result.answer}</p><button type="button" onClick={() => void onAccept(agentRun.result.answer, agentRun.profile?.label || 'Trace Agent')}>保留到 Trace</button></article>}
        </section>
      </section>

      {compact && focusedObservation && (
        <article className="trace-compact-observation" aria-label="当前观察详情">
          <span className={`trace-status trace-status-${statusClass[focusedObservation.status]}`}>{focusedObservation.status}</span>
          <strong>{focusedObservation.text}</strong>
          <small>{focusedObservation.source || 'Trace 本机工作区'}{focusedObservation.createdAt ? ` · ${focusedObservation.createdAt}` : ''}</small>
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
                  {observation.source && <span>来源 {observation.source}</span>}
                </div>
              </div>
              {observation.createdAt && <time>{observation.createdAt}</time>}
            </article>
          ))}
        </div>
      </section>

      <p className="trace-footer-note">这里显示的是桌面端同一份本机工作区；保存、讨论和 Agent 结果会回到 Trace。</p>
    </aside>
  )
}
