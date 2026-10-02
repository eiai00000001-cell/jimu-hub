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

interface SelectOption {
  value: string
  label: string
}

interface SelectFieldProps extends FieldMeta, SelectHTMLAttributes<HTMLSelectElement> {
  /** 文字列配列を渡した場合は値と表示文言が一致するものとして扱う(例: 敬称)。値と表示文言を分けたい場合(例: 未選択を表す空文字)は`{ value, label }`の配列を渡す */
  options: readonly string[] | readonly SelectOption[]
}

function toOption(option: string | SelectOption): SelectOption {
  return typeof option === 'string' ? { value: option, label: option } : option
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
        {options.map(toOption).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldWrapper>
  )
}
