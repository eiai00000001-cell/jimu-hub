import { useEffect, useState, type ReactElement } from 'react'
import { AppShell } from '../layout/AppShell'
import { Button, TextLink } from '../components/Button'
import { Badge } from '../components/Badge'
import { Message } from '../components/Message'
import { toErrorMessage } from '../utils/error-message'
import type { AccountKind, AccountView } from '@shared/types/account'
import { ACCOUNT_MESSAGES, NAVIGATION_MESSAGES } from '@shared/messages/messages'

const KIND_LABELS: Record<AccountKind, string> = { expense: '経費', income: '収入' }

interface AccountListPageProps {
  onBackToList: () => void
}

/**
 * 勘定科目管理画面[F-17]
 * 参照元: 詳細設計書3.21章・4.17章
 * 名称の入力エラー(空欄・重複)は入力欄の下に、それ以外の業務エラー(利用停止不可・利用済み)は画面上部に表示する。
 */
export function AccountListPage({ onBackToList }: AccountListPageProps): ReactElement {
  const [accounts, setAccounts] = useState<AccountView[] | null>(null)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<AccountKind>('expense')
  const [addError, setAddError] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    window.jimuhubApi.listAccounts({ includeInactive: true }).then((result) => {
      if (!cancelled) setAccounts(result)
    })
    return () => {
      cancelled = true
    }
  }, [reloadCount])

  const reload = (): void => setReloadCount((count) => count + 1)

  const renamingAccount = accounts?.find((account) => account.id === renamingId)
  const dirty =
    newName.trim() !== '' ||
    (renamingAccount !== undefined && renameValue.trim() !== renamingAccount.name)

  async function handleAdd(): Promise<void> {
    setPageError(null)
    try {
      await window.jimuhubApi.createAccount({ name: newName, kind: newKind })
      setNewName('')
      setAddError(null)
      reload()
    } catch (error) {
      setAddError(toErrorMessage(error, ACCOUNT_MESSAGES.nameRequired))
    }
  }

  async function handleRename(id: number): Promise<void> {
    setPageError(null)
    try {
      await window.jimuhubApi.renameAccount(id, renameValue)
      setRenamingId(null)
      setRenameError(null)
      reload()
    } catch (error) {
      setRenameError(toErrorMessage(error, ACCOUNT_MESSAGES.nameRequired))
    }
  }

  /** 確認ダイアログ(`window.confirm`)の後に、利用停止・再開・削除を実行する */
  async function runAction(action: () => Promise<unknown>, confirmMessage?: string): Promise<void> {
    if (confirmMessage !== undefined && !window.confirm(confirmMessage)) return
    setPageError(null)
    try {
      await action()
      reload()
    } catch (error) {
      setPageError(toErrorMessage(error, ACCOUNT_MESSAGES.notFound))
    }
  }

  return (
    <AppShell
      screenName="勘定科目の管理"
      activeMenu="home"
      pageTitle="勘定科目の管理"
      confirmLeave={() => !dirty || window.confirm(NAVIGATION_MESSAGES.confirmLeave)}
    >
      {pageError ? <Message variant="error">{pageError}</Message> : null}

      <div className="panel account-add">
        <div className="block-title">科目を追加</div>
        <div className="inline-form">
          <div className={`field account-name-field${addError ? ' error' : ''}`}>
            <label htmlFor="account-new-name">
              名称<span className="required">必須</span>
            </label>
            <input
              id="account-new-name"
              type="text"
              placeholder="例: 会議費(30文字まで)"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            {addError ? <div className="error-message">{addError}</div> : null}
          </div>
          <div className="field account-kind-field">
            <label htmlFor="account-new-kind">
              区分<span className="required">必須</span>
            </label>
            <select
              id="account-new-kind"
              value={newKind}
              onChange={(event) => setNewKind(event.target.value as AccountKind)}
            >
              <option value="expense">経費</option>
              <option value="income">収入</option>
            </select>
          </div>
          <Button variant="primary" onClick={() => void handleAdd()}>
            追加
          </Button>
        </div>
        <div className="hint">区分は追加後に変更できません</div>
      </div>

      {accounts === null ? null : (
        <table className="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>区分</th>
              <th>状態</th>
              <th className="op">操作</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => {
              const renaming = renamingId === account.id
              return (
                <tr key={account.id}>
                  <td>
                    {renaming ? (
                      <div className={`field${renameError ? ' error' : ''}`}>
                        <input
                          type="text"
                          aria-label={`${account.name}の新しい名称`}
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                        />
                        {renameError ? <div className="error-message">{renameError}</div> : null}
                      </div>
                    ) : (
                      <>
                        {account.name}
                        {account.defaultKey !== null ? (
                          <span className="badge badge-soon account-system-badge">
                            システム既定
                          </span>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td>{KIND_LABELS[account.kind]}</td>
                  <td>
                    <Badge variant={account.status === 'active' ? 'active' : 'inactive'} />
                  </td>
                  <td className="op">
                    {renaming ? (
                      <>
                        <Button
                          variant="primary"
                          className="btn-sm"
                          onClick={() => void handleRename(account.id)}
                        >
                          確定
                        </Button>
                        <Button
                          className="btn-sm account-op"
                          onClick={() => {
                            setRenamingId(null)
                            setRenameError(null)
                          }}
                        >
                          キャンセル
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          className="btn-sm account-op"
                          onClick={() => {
                            setRenamingId(account.id)
                            setRenameValue(account.name)
                            setRenameError(null)
                          }}
                        >
                          名称を変更
                        </Button>
                        {account.status === 'active' && account.defaultKey === null ? (
                          <Button
                            className="btn-sm account-op"
                            onClick={() =>
                              void runAction(
                                () => window.jimuhubApi.deactivateAccount(account.id),
                                `${ACCOUNT_MESSAGES.confirmDeactivateTitle}\n${ACCOUNT_MESSAGES.confirmDeactivate(account.name)}`
                              )
                            }
                          >
                            利用停止
                          </Button>
                        ) : null}
                        {account.status === 'inactive' ? (
                          <Button
                            className="btn-sm account-op"
                            onClick={() =>
                              void runAction(() => window.jimuhubApi.reactivateAccount(account.id))
                            }
                          >
                            利用を再開
                          </Button>
                        ) : null}
                        {account.deletable ? (
                          <Button
                            className="btn-sm account-op"
                            onClick={() =>
                              void runAction(
                                () => window.jimuhubApi.deleteAccount(account.id),
                                ACCOUNT_MESSAGES.confirmDelete(account.name)
                              )
                            }
                          >
                            削除
                          </Button>
                        ) : null}
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div className="back-link">
        <TextLink onClick={onBackToList}>&larr; 一覧へ戻る</TextLink>
      </div>
    </AppShell>
  )
}
