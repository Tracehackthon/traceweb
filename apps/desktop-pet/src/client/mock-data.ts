export type ObservationStatus = '待确认' | '候选中' | '已采用' | '需回顾' | '已暂存' | '已拒绝'

export type CandidateStatus = '候选中' | '已采用' | '已暂存' | '已拒绝'

export type Observation = {
  id: string
  text: string
  status: ObservationStatus
  confidence?: number
  source?: string
  createdAt: string
  isNew?: boolean
}
