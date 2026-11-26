/** Gastos y otros ingresos del dojo: movimientos del mes, fijos mensuales y categorías */
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  financeApi, type FinCategory, type FinEntriesMeta, type FinEntry, type FinKind, type FinRecurring,
} from '../../api/reports';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Badge, Button, Card, Divider, EmptyState, Field, Icon, IconButton, Loading, Notice, Text } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { DateField, FormGrid, Select, SwitchRow } from '../../ui/forms';
import { palette, space } from '../../theme/tokens';
import { useIsWide } from '../../navigation/AppShell';
import { t } from '../../i18n';
import { dayShort, money } from '../../utils/format';
import { Tile } from '../billing/bits';
import { ExportButton, exportCsv, monthLong, rt, ymdLocal } from './bits';

type Msg = { tone: 'success' | 'danger'; text: string } | null;
const METHODS = ['cash', 'transfer', 'card', 'other'] as const;
const num = (s: string) => Number(s.replace(',', '.'));
const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return ymdLocal(new Date(y, m, 0)); };
const shiftMonth = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); return ymdLocal(new Date(y, m - 1 + n, 1)).slice(0, 7); };

// ---------------------------------------------------------------------------
function EntryDialog({ visible, kind, entry, categories, defaultDate, onClose, onSaved }: {
  visible: boolean; kind: FinKind; entry: FinEntry | null; categories: FinCategory[]; defaultDate: string;
  onClose: () => void; onSaved: (text: string) => void;
}) {
  const [k, setK] = useState<FinKind>(kind);
  const [cat, setCat] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<string | null>(defaultDate);
  const [desc, setDesc] = useState('');
  const [method, setMethod] = useState<string | null>(null);
  const [ref, setRef] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setK(entry?.kind ?? kind); setCat(entry?.category_id ?? null); setAmount(entry ? String(entry.amount) : '');
    setDate(entry?.entry_date ?? defaultDate); setDesc(entry?.description ?? ''); setMethod(entry?.method ?? null);
    setRef(entry?.reference ?? ''); setNotes(entry?.notes ?? ''); setErr(null); setConfirmDel(false);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const opts = categories.filter((c) => c.kind === k && (c.active || c.id === cat)).map((c) => ({ value: c.id, label: c.name }));

  async function save() {
    const n = num(amount);
    if (!cat || !(n > 0) || !date) { setErr(rt('required')); return; }
    setBusy('save'); setErr(null);
    const b = { kind: k, category_id: cat, amount: n, entry_date: date, description: desc.trim() || null, method: (method as FinEntry['method']) ?? null, reference: ref.trim() || null, notes: notes.trim() || null };
    try {
      if (entry) await financeApi.updateEntry(entry.id, b); else await financeApi.createEntry(b);
      onSaved(rt('saved'));
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(null); }
  }
  async function del() {
    if (!entry) return;
    setBusy('delete'); setErr(null);
    try { await financeApi.deleteEntry(entry.id); onSaved(rt('deleted')); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(null); }
  }

  return (
    <Dialog visible={visible} onClose={onClose} title={entry ? rt('editEntry') : rt(k === 'expense' ? 'newExpense' : 'newIncome')}
      actions={confirmDel ? (
        <><Button label={t('common.cancel')} variant="ghost" onPress={() => setConfirmDel(false)} /><Button label={rt('delete')} variant="danger" loading={busy === 'delete'} onPress={del} /></>
      ) : (
        <>
          {entry ? <Button label={rt('delete')} variant="ghost" onPress={() => setConfirmDel(true)} /> : null}
          <Button label={t('common.cancel')} variant="ghost" onPress={onClose} />
          <Button label={t('common.save')} loading={busy === 'save'} onPress={save} />
        </>
      )}>
      {confirmDel && entry ? (
        <Notice tone="danger" title={rt('deleteEntryTitle')}>{rt('deleteEntryBody', { what: entry.description || entry.category, amount: money(entry.amount, entry.currency) })}</Notice>
      ) : (
        <View style={{ gap: space.md }}>
          {entry ? (
            <Select label={rt('kind')} value={k} onChange={(v) => { if (v) { setK(v); setCat(null); } }}
              options={[{ value: 'expense' as FinKind, label: rt('k_expense') }, { value: 'income' as FinKind, label: rt('k_income') }]} />
          ) : null}
          <Select label={`${rt('category')} *`} value={cat} onChange={setCat} options={opts} />
          <FormGrid>
            <Field label={`${rt('amount')} *`} value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" />
            <DateField label={`${rt('date')} *`} value={date} onChange={setDate} />
          </FormGrid>
          <Field label={rt('description')} value={desc} onChangeText={setDesc} maxLength={255} />
          <FormGrid>
            <Select label={rt('method')} value={method} onChange={setMethod} allowClear options={METHODS.map((m) => ({ value: m, label: rt(`m_${m}`) }))} />
            <Field label={rt('reference')} value={ref} onChangeText={setRef} maxLength={100} />
          </FormGrid>
          <Field label={rt('notes')} value={notes} onChangeText={setNotes} maxLength={500} multiline />
          {entry?.recurring_id ? <Text variant="caption" color={palette.ink2}>{rt('fixed')}</Text> : null}
        </View>
      )}
      {err ? <Notice tone="danger">{err}</Notice> : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function RecurringDialog({ visible, item, categories, onClose, onSaved }: {
  visible: boolean; item: FinRecurring | null; categories: FinCategory[]; onClose: () => void; onSaved: (text: string) => void;
}) {
  const [k, setK] = useState<FinKind>('expense');
  const [cat, setCat] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [day, setDay] = useState('1');
  const [starts, setStarts] = useState<string | null>(null);
  const [ends, setEnds] = useState<string | null>(null);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setK(item?.kind ?? 'expense'); setCat(item?.category_id ?? null); setAmount(item ? String(item.amount) : ''); setDesc(item?.description ?? '');
    setDay(String(item?.day_of_month ?? 1)); setStarts(item?.starts_on ?? `${ymdLocal(new Date()).slice(0, 7)}-01`); setEnds(item?.ends_on ?? null);
    setActive(item ? !!item.active : true); setErr(null); setConfirmDel(false);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const opts = categories.filter((c) => c.kind === k && (c.active || c.id === cat)).map((c) => ({ value: c.id, label: c.name }));

  async function save() {
    const n = num(amount); const d = Number(day);
    if (!cat || !(n > 0) || !starts || !(d >= 1 && d <= 28)) { setErr(rt('required')); return; }
    setBusy('save'); setErr(null);
    const b = { kind: k, category_id: cat, amount: n, description: desc.trim() || null, day_of_month: d, starts_on: starts, ends_on: ends, active };
    try {
      if (item) await financeApi.updateRecurring(item.id, b); else await financeApi.createRecurring(b);
      onSaved(rt('saved'));
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(null); }
  }
  async function del() {
    if (!item) return;
    setBusy('delete');
    try { await financeApi.deleteRecurring(item.id); onSaved(rt('deleted')); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(null); }
  }

  return (
    <Dialog visible={visible} onClose={onClose} title={item ? rt('editRecurring') : rt('newRecurring')}
      actions={confirmDel ? (
        <><Button label={t('common.cancel')} variant="ghost" onPress={() => setConfirmDel(false)} /><Button label={rt('delete')} variant="danger" loading={busy === 'delete'} onPress={del} /></>
      ) : (
        <>
          {item ? <Button label={rt('delete')} variant="ghost" onPress={() => setConfirmDel(true)} /> : null}
          <Button label={t('common.cancel')} variant="ghost" onPress={onClose} />
          <Button label={t('common.save')} loading={busy === 'save'} onPress={save} />
        </>
      )}>
      {confirmDel ? <Notice tone="danger" title={rt('deleteRecurringTitle')}>{rt('deleteRecurringBody')}</Notice> : (
        <View style={{ gap: space.md }}>
          <FormGrid>
            <Select label={rt('kind')} value={k} onChange={(v) => { if (v) { setK(v); setCat(null); } }}
              options={[{ value: 'expense' as FinKind, label: rt('k_expense') }, { value: 'income' as FinKind, label: rt('k_income') }]} />
            <Select label={`${rt('category')} *`} value={cat} onChange={setCat} options={opts} />
          </FormGrid>
          <FormGrid>
            <Field label={`${rt('amount')} *`} value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" />
            <Field label={`${rt('dayOfMonth')} *`} hint={rt('dayHint')} value={day} onChangeText={(v) => setDay(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />
          </FormGrid>
          <Field label={rt('description')} value={desc} onChangeText={setDesc} maxLength={255} />
          <FormGrid>
            <DateField label={`${rt('startsOn')} *`} value={starts} onChange={setStarts} />
            <DateField label={rt('endsOn')} value={ends} onChange={setEnds} />
          </FormGrid>
          {item ? <SwitchRow label={rt('activeRec')} value={active} onChange={setActive} /> : null}
          <Text variant="caption" color={palette.ink2}>{rt('recurringHint')}</Text>
        </View>
      )}
      {err ? <Notice tone="danger">{err}</Notice> : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function CategoriesDialog({ visible, categories, onClose, onChanged }: {
  visible: boolean; categories: FinCategory[]; onClose: () => void; onChanged: () => void;
}) {
  const [kind, setKind] = useState<FinKind>('expense');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (visible) { setName(''); setErr(null); } }, [visible]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); onChanged(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  const list = categories.filter((c) => c.kind === kind);
  return (
    <Dialog visible={visible} onClose={onClose} title={rt('categories')} actions={<Button label={t('common.close')} variant="ghost" onPress={onClose} />}>
      <View style={{ flexDirection: 'row', gap: space.xs }}>
        {(['expense', 'income'] as const).map((k) => (
          <Button key={k} label={rt(k === 'expense' ? 'expenseCats' : 'incomeCats')} size="sm" variant={kind === k ? 'dark' : 'secondary'} onPress={() => setKind(k)} style={{ flexGrow: 1 }} />
        ))}
      </View>
      <View>
        {list.map((c, i) => (
          <View key={c.id}>
            {i > 0 ? <Divider /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text color={c.active ? palette.ink : palette.ink3} numberOfLines={1}>{c.name}</Text>
                <Text variant="caption" color={palette.ink2}>{c.entries ? rt('inUse', { count: c.entries }) : '—'}{c.active ? '' : ` · ${rt('hidden')}`}</Text>
              </View>
              {c.entries ? (
                <Button label={c.active ? rt('hide') : rt('show')} size="sm" variant="ghost" disabled={busy}
                  onPress={() => run(() => financeApi.updateCategory(c.id, { active: !c.active }))} />
              ) : (
                <IconButton icon="trash-2" label={rt('delete')} size="sm" disabled={busy} onPress={() => run(() => financeApi.deleteCategory(c.id))} />
              )}
            </View>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'flex-end' }}>
        <View style={{ flex: 1, minWidth: 0 }}><Field label={rt('newCategory')} value={name} onChangeText={setName} maxLength={80} /></View>
        <Button label={t('common.add')} disabled={!name.trim()} loading={busy}
          onPress={() => run(async () => { await financeApi.createCategory({ kind, name: name.trim() }); setName(''); })} />
      </View>
      {err ? <Notice tone="danger">{err}</Notice> : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
export function MovementsTab() {
  const wide = useIsWide();
  const router = useRouter();
  const [month, setMonth] = useState(ymdLocal(new Date()).slice(0, 7));
  const [version, setVersion] = useState(0);
  const range = { from: `${month}-01`, to: lastDay(month) };
  const entries = useApi(() => financeApi.entries(range), [month, version]);
  const cats = useApi(() => financeApi.categories(), [version]);
  const recurring = useApi(() => financeApi.recurring(), [version]);
  const [dialog, setDialog] = useState<{ kind: FinKind; entry: FinEntry | null } | null>(null);
  const [recDialog, setRecDialog] = useState<{ item: FinRecurring | null } | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const rows = entries.data?.data ?? [];
  const meta = entries.data?.meta as FinEntriesMeta | undefined;
  const tuition = meta?.tuition;
  const categories = cats.data ?? [];
  const today = ymdLocal(new Date());
  const defaultDate = today.startsWith(month) ? today : `${month}-01`;
  const changed = (text: string) => { setDialog(null); setRecDialog(null); setMsg({ tone: 'success', text }); setVersion((v) => v + 1); };
  const cur = rows[0]?.currency ?? 'MXN';
  const sorted = rows;
  const goBilling = () => router.push(`/billing?tab=payments&month=${month}` as never);

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.sm, alignItems: wide ? 'center' : 'stretch', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <IconButton icon="chevron-left" label={rt('prevMonth')} onPress={() => setMonth((m) => shiftMonth(m, -1))} />
          <Text variant="heading" style={{ minWidth: 160, textAlign: 'center', flexShrink: 1 }}>{monthLong(month)}</Text>
          <IconButton icon="chevron-right" label={rt('nextMonth')} onPress={() => setMonth((m) => shiftMonth(m, 1))} />
        </View>
        <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: wide ? 'wrap' : 'nowrap' }}>
          <Button label={rt('newExpense')} icon="minus-circle" onPress={() => setDialog({ kind: 'expense', entry: null })} style={wide ? undefined : { flex: 1 }} />
          <Button label={rt('newIncome')} variant="secondary" icon="plus-circle" onPress={() => setDialog({ kind: 'income', entry: null })} style={wide ? undefined : { flex: 1 }} />
        </View>
      </View>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {entries.error ? <Notice tone="danger">{entries.error}</Notice> : null}

      <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
        <Tile label={rt('monthIncome')} value={money(meta?.income_total ?? 0, cur)} />
        <Tile label={rt('monthExpense')} value={money(meta?.expense_total ?? 0, cur)} />
        <Tile label={rt('monthNet')} value={money(meta?.net ?? 0, cur)} tone={(meta?.net ?? 0) < 0 ? palette.danger : undefined} />
      </Card>

      {rows.length ? (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <ExportButton onPress={() => exportCsv(`gastos_ingresos_${month}`, [rt('date'), rt('kind'), rt('category'), rt('description'), rt('amount'), rt('method'), rt('reference'), rt('notes')],
            rows.map((e) => [e.entry_date, rt(`k_${e.kind}`), e.category, e.description, e.kind === 'expense' ? -e.amount : e.amount, e.method ? rt(`m_${e.method}`) : '', e.reference, e.notes]))} />
        </View>
      ) : null}
      <Card padding={0} style={{ overflow: 'hidden' }}>
        {entries.loading && !entries.data ? <Loading /> : sorted.length === 0 && !tuition?.count ? (
          <EmptyState icon="file-text" title={rt('noEntries')} body={rt('noEntriesBody')} />
        ) : null}
        {/* Cobros a alumnos: solo lectura, se registran en Cobranza */}
        {tuition?.count ? (
          <Pressable accessibilityRole="link" onPress={goBilling}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, backgroundColor: palette.sunken }}>
            <Icon name="users" size={18} color={palette.ink2} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text variant="bodyStrong" numberOfLines={1}>{rt('tuition')}</Text>
              <Text variant="caption" color={palette.ink2} numberOfLines={1}>{rt('paymentsN', { count: tuition.count })} · {rt('fromBilling')}</Text>
            </View>
            <Text variant="bodyStrong">+{money(tuition.amount, cur)}</Text>
            <Icon name="chevron-right" size={18} color={palette.ink3} />
          </Pressable>
        ) : null}
        {tuition?.online_fees ? (
          <View>
            <Divider />
            <Pressable accessibilityRole="link" onPress={goBilling}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, backgroundColor: palette.sunken }}>
              <Icon name="percent" size={18} color={palette.ink2} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text variant="bodyStrong" numberOfLines={1}>{rt('onlineFees')}</Text>
                <Text variant="caption" color={palette.ink2} numberOfLines={1}>{rt('feesHint')}</Text>
              </View>
              <Text variant="bodyStrong">−{money(tuition.online_fees, cur)}</Text>
              <Icon name="chevron-right" size={18} color={palette.ink3} />
            </Pressable>
          </View>
        ) : null}
        {sorted.map((e, i) => (
          <View key={e.id}>
            {i > 0 || tuition?.count ? <Divider /> : null}
            <Pressable accessibilityRole="button" onPress={() => setDialog({ kind: e.kind, entry: e })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md }}>
              <Icon name={e.kind === 'expense' ? 'arrow-up-right' : 'arrow-down-left'} size={18} color={palette.ink2} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text variant="bodyStrong" numberOfLines={1}>{e.description || e.category}</Text>
                <Text variant="caption" color={palette.ink2} numberOfLines={1}>
                  {[dayShort(e.entry_date), e.description ? e.category : null, e.method ? rt(`m_${e.method}`) : null, e.reference].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text variant="bodyStrong">{e.kind === 'expense' ? '−' : '+'}{money(e.amount, e.currency)}</Text>
                {e.recurring_id ? <Badge label={rt('fixed')} /> : null}
              </View>
            </Pressable>
          </View>
        ))}
      </Card>

      <Card style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' }}>
          <Text variant="bodyStrong">{rt('recurringTitle')}</Text>
          <View style={{ flexDirection: 'row', gap: space.xs }}>
            <Button label={rt('manageCategories')} size="sm" variant="ghost" icon="tag" onPress={() => setCatsOpen(true)} />
            <Button label={rt('newRecurring')} size="sm" variant="secondary" icon="repeat" onPress={() => setRecDialog({ item: null })} />
          </View>
        </View>
        <Text variant="small" color={palette.ink2}>{rt('recurringHint')}</Text>
        {(recurring.data ?? []).length === 0 ? <Text variant="small" color={palette.ink3}>{rt('noRecurring')}</Text> : (recurring.data ?? []).map((r, i) => (
          <View key={r.id}>
            {i > 0 ? <Divider /> : null}
            <Pressable accessibilityRole="button" onPress={() => setRecDialog({ item: r })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs, opacity: r.active ? 1 : 0.6 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="bodyStrong" numberOfLines={1}>{r.description || r.category}</Text>
                <Text variant="caption" color={palette.ink2}>{[rt(`k_${r.kind}`), r.description ? r.category : null, rt('everyMonth', { day: r.day_of_month })].filter(Boolean).join(' · ')}</Text>
              </View>
              {r.active ? null : <Badge label={rt('paused')} />}
              <Text variant="bodyStrong">{money(r.amount, r.currency)}</Text>
            </Pressable>
          </View>
        ))}
      </Card>

      <EntryDialog visible={!!dialog} kind={dialog?.kind ?? 'expense'} entry={dialog?.entry ?? null} categories={categories} defaultDate={defaultDate}
        onClose={() => setDialog(null)} onSaved={changed} />
      <RecurringDialog visible={!!recDialog} item={recDialog?.item ?? null} categories={categories} onClose={() => setRecDialog(null)} onSaved={changed} />
      <CategoriesDialog visible={catsOpen} categories={categories} onClose={() => setCatsOpen(false)} onChanged={() => setVersion((v) => v + 1)} />
    </View>
  );
}
