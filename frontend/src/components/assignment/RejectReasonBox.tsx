import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { RejectReason } from '@/api'
import { missingCommentReason, type RejectDraft } from '@/lib/rejectReasons'
import { cn } from '@/lib/utils'

interface Props {
  options: RejectReason[]
  draft: RejectDraft
  onChange: (d: RejectDraft) => void
  comment: string
  onComment: (text: string) => void
  onCancel: () => void
  onConfirm: (reasons: string[]) => void
  /** AI가 찾은 원인 코드 (칩에 'AI' 표시) */
  aiCodes: string[]
  className?: string
}

/**
 * 반려 사유 상자: 하나 이상 고르고 확정한다. 열려 있는 동안 숫자키로 사유를 켜고 끄고, Enter 확정, Esc 취소.
 * 코멘트 입력 중에는 숫자가 글자로 들어가고, Enter는 확정(Shift+Enter는 줄바꿈)이다.
 */
export function RejectReasonBox({ options, draft, onChange, comment, onComment, onCancel, onConfirm, aiCodes, className }: Props) {
  const [error, setError] = useState('')
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const selected = new Set(draft.reasons)

  const toggle = (code: string) => {
    setError('')
    onChange({ ...draft, reasons: selected.has(code) ? draft.reasons.filter((c) => c !== code) : [...draft.reasons, code] })
  }
  const confirm = () => {
    if (!draft.reasons.length) return setError('반려 사유를 하나 이상 고르세요.')
    const needs = missingCommentReason(options, draft.reasons, comment)
    if (needs) {
      setError(`‘${needs.label}’ 사유는 코멘트를 적어야 합니다.`)
      commentRef.current?.focus()
      return
    }
    onConfirm(draft.reasons)
  }

  // 캡처 단계에서 먼저 받는다: 뒤쪽 화면(검수 패널·크게 보기)의 단축키와 대화상자의 Esc 닫기보다 앞선다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      const typing = (e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'INPUT'
      if (e.key === 'Escape') onCancel()
      else if (e.key === 'Enter' && !e.shiftKey) confirm()
      else if (!typing && /^[1-9]$/.test(e.key) && options[Number(e.key) - 1]) toggle(options[Number(e.key) - 1].code)
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const ai = new Set(aiCodes)
  return (
    <div
      data-testid="reject-box"
      className={cn('space-y-2 rounded-lg border border-destructive/50 bg-destructive/5 p-2.5 text-card-foreground', className)}
    >
      <p className="text-xs font-semibold text-destructive">
        반려 사유 <span className="font-normal text-muted-foreground">· 하나 이상 선택 (숫자키)</span>
      </p>
      {aiCodes.length > 0 && <p className="text-[11px] text-muted-foreground">AI가 찾은 원인을 미리 골라 두었습니다. 맞지 않으면 바꾸세요.</p>}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="반려 사유">
        {options.map((o, i) => {
          const on = selected.has(o.code)
          return (
            <button
              key={o.code}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(o.code)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs transition-colors',
                on ? 'border-destructive bg-destructive text-white' : 'border-border bg-card hover:bg-muted',
              )}
            >
              {on && <Check className="-ml-0.5 mr-0.5 inline size-3" />}
              <span className="tabular-nums opacity-70">{i + 1}</span> {o.label}
              {ai.has(o.code) && <span className="ml-1 text-[10px] opacity-70">AI</span>}
            </button>
          )
        })}
      </div>
      <Textarea
        ref={commentRef}
        aria-label="코멘트"
        placeholder={options.some((o) => o.requiresComment) ? '코멘트 (기타를 고르면 필수)' : '코멘트 (선택)'}
        value={comment}
        onChange={(e) => {
          setError('')
          onComment(e.target.value)
        }}
        className="min-h-14 bg-card text-sm"
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          취소 <span className="text-[11px] text-muted-foreground">Esc</span>
        </Button>
        <Button variant="destructive" size="sm" className="bg-destructive text-white hover:bg-destructive/90" onClick={confirm}>
          반려 확정 <span className="text-[11px] opacity-80">Enter</span>
        </Button>
      </div>
    </div>
  )
}
