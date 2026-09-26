import type { ButtonHTMLAttributes, ReactElement } from 'react'

type Variant = 'primary' | 'secondary' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

/** 押せる物(ボタン): デザインガイド5.1章。角丸6px・高さ32px */
export function Button({ variant = 'secondary', className, ...rest }: ButtonProps): ReactElement {
  const classes = ['btn', `btn-${variant}`, className].filter(Boolean).join(' ')
  return <button type="button" className={classes} {...rest} />
}

/** テキストリンク(押せる物): 枠なし・下線付き */
export function TextLink(props: ButtonHTMLAttributes<HTMLButtonElement>): ReactElement {
  const { className, ...rest } = props
  const classes = ['link', className].filter(Boolean).join(' ')
  return <button type="button" className={classes} {...rest} />
}
