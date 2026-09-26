import type {
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes
} from 'react'

interface FieldMeta {
  label: string
  required?: boolean
  error?: string
  hint?: string
}

interface FieldWrapperProps extends FieldMeta {
  children: ReactNode
}

/** 書き込む物(入力欄)の共通ラッパー: ラベル・必須表記・ヒント・エラー表示 */
function FieldWrapper({ label, required, error, hint, children }: FieldWrapperProps): ReactElement {
  return (
    <div className={`field${error ? ' error' : ''}`}>
      <label>
        {label}
        {required ? <span className="required">必須</span> : null}
      </label>
      {children}
      {hint && !error ? <div className="hint">{hint}</div> : null}
      {error ? <div className="error-message">{error}</div> : null}
    </div>
  )
}

interface TextFieldProps extends FieldMeta, InputHTMLAttributes<HTMLInputElement> {}

export function TextField({
  label,
  required,
  error,
  hint,
  ...inputProps
}: TextFieldProps): ReactElement {
  return (
    <FieldWrapper label={label} required={required} error={error} hint={hint}>
      <input type="text" aria-label={label} aria-invalid={Boolean(error)} {...inputProps} />
    </FieldWrapper>
  )
}

interface TextAreaFieldProps extends FieldMeta, TextareaHTMLAttributes<HTMLTextAreaElement> {}

export function TextAreaField({
  label,
  required,
  error,
  hint,
  ...textareaProps
}: TextAreaFieldProps): ReactElement {
  return (
    <FieldWrapper label={label} required={required} error={error} hint={hint}>
      <textarea aria-label={label} aria-invalid={Boolean(error)} {...textareaProps} />
    </FieldWrapper>
  )
}

interface SelectFieldProps extends FieldMeta, SelectHTMLAttributes<HTMLSelectElement> {
  options: readonly string[]
}

export function SelectField({
  label,
  required,
  error,
  hint,
  options,
  ...selectProps
}: SelectFieldProps): ReactElement {
  return (
    <FieldWrapper label={label} required={required} error={error} hint={hint}>
      <select aria-label={label} aria-invalid={Boolean(error)} {...selectProps}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </FieldWrapper>
  )
}
