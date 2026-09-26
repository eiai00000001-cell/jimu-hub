import type { ReactElement, ReactNode } from 'react'

type Variant = 'success' | 'error' | 'warning'

const ICONS: Record<Variant, string> = {
  success: '✓',
  error: '!',
  warning: '!'
}

interface MessageProps {
  variant: Variant
  children: ReactNode
}

/** 読むだけの物(メッセージ): デザインガイド5.1章。角丸なし・外周の枠なし・左4pxの帯 */
export function Message({ variant, children }: MessageProps): ReactElement {
  return (
    <div className={`message message-${variant}`} role={variant === 'success' ? 'status' : 'alert'}>
      <span className="message-icon" aria-hidden="true">
        {ICONS[variant]}
      </span>
      <span className="message-text">{children}</span>
    </div>
  )
}
