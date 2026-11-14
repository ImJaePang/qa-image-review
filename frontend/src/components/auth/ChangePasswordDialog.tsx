import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ChangePasswordForm } from './ChangePasswordForm'

/** 상단 메뉴의 '비밀번호 변경' (임시 비밀번호가 아니어도 본인이 언제든 바꿀 수 있다) */
export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>비밀번호 변경</DialogTitle>
          <DialogDescription>현재 비밀번호를 확인한 뒤 새 비밀번호로 바꿉니다.</DialogDescription>
        </DialogHeader>
        {/* 닫힐 때 입력이 남지 않도록 열 때마다 새로 만든다 */}
        {open && <ChangePasswordForm onDone={onClose} onCancel={onClose} />}
      </DialogContent>
    </Dialog>
  )
}
