import { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import ClientFormModal from '../components/clients/ClientFormModal';
import CompraForm from '../components/operations/CompraForm';
import VentaForm from '../components/operations/VentaForm';
import ArbitrajeForm from '../components/operations/ArbitrajeForm';
import TransferenciaEntreCuentasForm from '../components/operations/TransferenciaEntreCuentasForm';
import IngresoCapitalForm from '../components/operations/IngresoCapitalForm';
import RetiroCapitalForm from '../components/operations/RetiroCapitalForm';
import GastoForm from '../components/operations/GastoForm';
import PagoCCCruzadoForm from '../components/operations/PagoCCCruzadoForm';
import TransferenciaForm from '../components/operations/TransferenciaForm';
import TraspasoDeudaCCForm from '../components/operations/TraspasoDeudaCCForm';

interface Client {
  id: string;
  client_code: number;
  first_name: string;
  last_name: string;
  active: boolean;
  cc_enabled: boolean;
}

function clientLabel(c: Client): string {
  return `#${c.client_code} — ${c.last_name}, ${c.first_name}${c.cc_enabled ? ' [CC]' : ''}`;
}

interface CreateResult {
  id: string;
  operation_number: number;
}

interface DraftListItem {
  id: string;
  operation_number: number;
  type: string;
  date: string;
  client_id: string | null;
  client_name: string | null;
  updated_at: string;
}

interface DraftListResult {
  items: DraftListItem[];
  total: number;
  page: number;
  limit: number;
}

interface MovementDetailResume {
  id: string;
  operation_number: number;
  type: string;
  date: string;
  status: string;
  client_id: string | null;
  client_name: string | null;
}

interface MovementDraftEnvelopeResponse {
  movement_id: string;
  payload?: {
    reconstruction?: {
      source?: string;
      message?: string;
      manual_fields?: string[];
    };
  };
  updated_at: string;
}

const MOVEMENT_TYPES = [
  { value: 'COMPRA', label: 'Compra' },
  { value: 'VENTA', label: 'Venta' },
  { value: 'ARBITRAJE', label: 'Arbitraje' },
  { value: 'TRANSFERENCIA_ENTRE_CUENTAS', label: 'Transferencia entre cuentas' },
  { value: 'INGRESO_CAPITAL', label: 'Ingreso de capital' },
  { value: 'RETIRO_CAPITAL', label: 'Retiro de capital' },
  { value: 'GASTO', label: 'Gasto' },
  { value: 'PAGO_CC_CRUZADO', label: 'Pago CC cruzado' },
  { value: 'TRANSFERENCIA', label: 'Transferencia' },
  { value: 'TRASPASO_DEUDA_CC', label: 'Traspaso deuda CC' },
];

const CLIENT_OPTIONAL_TYPES = ['TRANSFERENCIA_ENTRE_CUENTAS', 'GASTO'];
const CLIENT_CC_REQUIRED_TYPES = ['RETIRO_CAPITAL', 'INGRESO_CAPITAL', 'PAGO_CC_CRUZADO'];

const DAY_NAMES: Record<number, string> = {
  0: 'Domingo',
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
};

function getDayName(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return DAY_NAMES[date.getDay()] || '';
}

function getInitialDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const CLIENT_CREATE_ROLES = ['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR'];
const DRAFT_SYNC_CHANNEL = 'fina:drafts-sync';
const DRAFT_SYNC_STORAGE_KEY = 'fina:drafts-sync:event';

type DraftSyncAction = 'draft_deleted' | 'draft_created' | 'draft_resumed' | 'draft_saved';
type DraftSyncEvent = {
  action: DraftSyncAction;
  movementId?: string;
  originTabId: string;
  ts: number;
};

export default function NuevaOperacionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { can, userId } = useAuth();
  const canCreateClient = can('clients.create', CLIENT_CREATE_ROLES);

  const [date, setDate] = useState(() => getInitialDate());
  const [type, setType] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [isClientOpen, setIsClientOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const comboRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);

  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);

  const [movementId, setMovementId] = useState<string | null>(null);
  const [operationNumber, setOperationNumber] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<DraftListItem[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [processingDraftId, setProcessingDraftId] = useState<string | null>(null);
  const latestDraftFetchRef = useRef(0);
  const latestClientsFetchRef = useRef(0);
  const isFetchingDraftsRef = useRef(false);
  const lastDraftFetchAtRef = useRef(0);
  const tabIdRef = useRef('');
  const syncChannelRef = useRef<BroadcastChannel | null>(null);
  const syncDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [creatingHeader, setCreatingHeader] = useState(false);
  const [patchingHeader, setPatchingHeader] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [formRemountKey, setFormRemountKey] = useState(0);
  const [error, setError] = useState('');
  const [resumeNotice, setResumeNotice] = useState('');
  const lastSyncedHeaderRef = useRef<{ date: string; type: string; clientId: string } | null>(null);
  const autoCreateInFlightRef = useRef(false);
  const patchSeqRef = useRef(0);
  const patchLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCreateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draftStorageKey = `new-operation-draft:${userId || 'anonymous'}`;
  const resetToken = (location.state as { newOperationResetToken?: string } | null)?.newOperationResetToken;
  const resumeMovementId = (location.state as { resumeMovementId?: string } | null)?.resumeMovementId;

  const clientRequired = type !== '' && !CLIENT_OPTIONAL_TYPES.includes(type);
  const clientOptional = type !== '' && CLIENT_OPTIONAL_TYPES.includes(type);
  const clientMustHaveCC = type !== '' && CLIENT_CC_REQUIRED_TYPES.includes(type);
  const dayName = date ? getDayName(date) : '';

  const fetchDrafts = useCallback(() => {
    const now = Date.now();
    if (isFetchingDraftsRef.current) return;
    if (now - lastDraftFetchAtRef.current < 300) return;

    isFetchingDraftsRef.current = true;
    lastDraftFetchAtRef.current = now;

    const requestId = ++latestDraftFetchRef.current;
    setLoadingDrafts(true);
    // Anti-cache puntual para evitar reaparición visual de borradores ya eliminados.
    api.get<DraftListResult>(`/movements/drafts?page=1&limit=20&_ts=${Date.now()}`)
      .then((res) => {
        if (requestId !== latestDraftFetchRef.current) return;
        setDrafts(res.items || []);
      })
      .catch(() => {
        if (requestId !== latestDraftFetchRef.current) return;
        setDrafts([]);
      })
      .finally(() => {
        isFetchingDraftsRef.current = false;
        if (requestId !== latestDraftFetchRef.current) return;
        setLoadingDrafts(false);
      });
  }, []);

  const fetchClients = useCallback(() => {
    const requestId = ++latestClientsFetchRef.current;
    setLoadingClients(true);
    return Promise.race<Client[]>([
      api.get<Client[]>('/clients?_ts=' + Date.now()),
      new Promise<Client[]>((_, reject) => {
        setTimeout(() => reject(new Error('FETCH_CLIENTS_TIMEOUT')), 6000);
      }),
    ])
      .then((list) => {
        if (requestId !== latestClientsFetchRef.current) return [] as Client[];
        const active = list.filter((c) => c.active);
        setClients(active);
        return active;
      })
      .catch(() => { return [] as Client[]; })
      .finally(() => {
        if (requestId !== latestClientsFetchRef.current) return;
        setLoadingClients(false);
      });
  }, []);

  useEffect(() => {
    if (!type) return;
    if (clientOptional && !clientRequired) return;
    fetchClients();
  }, [type, clientRequired, clientOptional, fetchClients]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  useEffect(() => {
    const key = 'nueva-operacion:tab-id';
    const existing = sessionStorage.getItem(key);
    if (existing) {
      tabIdRef.current = existing;
      return;
    }
    const generated = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(key, generated);
    tabIdRef.current = generated;
  }, []);

  const scheduleDraftSyncFetch = useCallback(() => {
    if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
    syncDebounceRef.current = setTimeout(() => {
      fetchDrafts();
    }, 200);
  }, [fetchDrafts]);

  const emitDraftSync = useCallback((action: DraftSyncAction, movementId?: string) => {
    const payload: DraftSyncEvent = {
      action,
      movementId,
      originTabId: tabIdRef.current,
      ts: Date.now(),
    };
    if (syncChannelRef.current) {
      syncChannelRef.current.postMessage(payload);
    }
    try {
      localStorage.setItem(DRAFT_SYNC_STORAGE_KEY, JSON.stringify(payload));
      localStorage.removeItem(DRAFT_SYNC_STORAGE_KEY);
    } catch {
      // Ignore localStorage sync issues to keep UX non-blocking.
    }
  }, []);

  useEffect(() => {
    function handleIncomingSync(raw: unknown) {
      const evt = raw as DraftSyncEvent | null;
      if (!evt || !evt.originTabId) return;
      if (evt.originTabId === tabIdRef.current) return;
      scheduleDraftSyncFetch();
    }

    function onStorage(e: StorageEvent) {
      if (e.key !== DRAFT_SYNC_STORAGE_KEY || !e.newValue) return;
      try {
        handleIncomingSync(JSON.parse(e.newValue));
      } catch {
        // Ignore malformed payload.
      }
    }

    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(DRAFT_SYNC_CHANNEL);
      syncChannelRef.current = channel;
      channel.onmessage = (event: MessageEvent) => handleIncomingSync(event.data);
    }
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('storage', onStorage);
      if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
      if (syncChannelRef.current) {
        syncChannelRef.current.close();
        syncChannelRef.current = null;
      }
    };
  }, [scheduleDraftSyncFetch]);

  useEffect(() => {
    function onWindowFocus() {
      fetchDrafts();
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') fetchDrafts();
    }
    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchDrafts]);

  useEffect(() => {
    return () => {
      if (patchLoadingTimerRef.current) {
        clearTimeout(patchLoadingTimerRef.current);
      }
    };
  }, []);

  const filteredClients = clients.filter((c) => {
    if ((type === 'TRASPASO_DEUDA_CC' || clientMustHaveCC) && !c.cc_enabled) return false;
    if (!clientQuery) return true;
    const q = clientQuery.toLowerCase();
    return (
      c.first_name.toLowerCase().includes(q) ||
      c.last_name.toLowerCase().includes(q) ||
      String(c.client_code).includes(q)
    );
  });
  const hasEligibleClients = !clientMustHaveCC || clients.some((c) => c.cc_enabled);

  const selectClient = useCallback((c: Client) => {
    setClientId(c.id);
    setClientQuery(clientLabel(c));
    setIsClientOpen(false);
    setActiveIndex(-1);
  }, []);

  const clearClient = useCallback(() => {
    setClientId('');
    setClientQuery('');
    setActiveIndex(-1);
  }, []);

  /** Cierra el modal sin confirmar y revierte la cabecera local a lastSynced para evitar bucle 409 ↔ PATCH debounced. */
  const revertHeaderToLastSynced = useCallback(() => {
    const last = lastSyncedHeaderRef.current;
    if (!last) {
      setConfirmClearOpen(false);
      return;
    }
    setDate(last.date);
    setType(last.type);
    setClientId(last.clientId);
    const found = clients.find((c) => c.id === last.clientId);
    setClientQuery(found ? clientLabel(found) : '');
    setConfirmClearOpen(false);
    setIsClientOpen(false);
    setActiveIndex(-1);
  }, [clients]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setIsClientOpen(false);
        setActiveIndex(-1);
        if (clientId) {
          const found = clients.find((c) => c.id === clientId);
          if (found) setClientQuery(clientLabel(found));
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [clientId, clients]);

  useEffect(() => {
    // Legacy safety: never auto-resume from sessionStorage.
    sessionStorage.removeItem(draftStorageKey);
  }, [draftStorageKey, userId]);

  useEffect(() => {
    if (!resetToken) return;
    // Explicit menu intent: start a fresh wizard without touching backend drafts.
    clearDraftSession();
    resetWizard();
  }, [resetToken]);

  useEffect(() => {
    if (!resumeMovementId) return;
    setError('');
    setResumeNotice('');
    api.get<MovementDetailResume>(`/movements/${resumeMovementId}`)
      .then((detail) => {
        setMovementId(detail.id);
        setOperationNumber(detail.operation_number);
        setType(detail.type);
        setDate(detail.date);
        setClientId(detail.client_id || '');
        setClientQuery(detail.client_name || '');
        lastSyncedHeaderRef.current = {
          date: detail.date,
          type: detail.type,
          clientId: detail.client_id || '',
        };
      })
      .catch((err: any) => setError(err?.message || 'No se pudo reanudar la operación de corrección.'));

    api.get<MovementDraftEnvelopeResponse>(`/movements/${resumeMovementId}/draft`)
      .then((draftRes) => {
        const reconstruction = draftRes?.payload?.reconstruction;
        if (!reconstruction?.message) return;
        const fields = reconstruction.manual_fields || [];
        if (fields.length > 0) {
          setResumeNotice(`${reconstruction.message} Revisar manualmente: ${fields.join(', ')}.`);
          return;
        }
        setResumeNotice(reconstruction.message);
      })
      .catch(() => {
        // No draft metadata available; keep silent.
      });
  }, [resumeMovementId]);

  function clearDraftSession() {
    sessionStorage.removeItem(draftStorageKey);
  }

  function resetWizard() {
    lastSyncedHeaderRef.current = null;
    setMovementId(null);
    setOperationNumber(null);
    setDate(getInitialDate());
    setType('');
    setClientId('');
    setClientQuery('');
    setIsClientOpen(false);
    setActiveIndex(-1);
    setError('');
    setResumeNotice('');
    setConfirmClearOpen(false);
    setFormRemountKey((k) => k + 1);
  }

  function handleComboKeyDown(e: React.KeyboardEvent) {
    if (!isClientOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setIsClientOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i < filteredClients.length - 1 ? i + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i > 0 ? i - 1 : filteredClients.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < filteredClients.length) {
        selectClient(filteredClients[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsClientOpen(false);
      setActiveIndex(-1);
    }
  }

  const ensureMovementHeader = useCallback(async () => {
    if (movementId || resumeMovementId || autoCreateInFlightRef.current) return;
    if (!date || !type) return;
    if (clientRequired && !clientId) return;

    setError('');
    autoCreateInFlightRef.current = true;
    setCreatingHeader(true);
    try {
      const payload = {
        type,
        date,
        day_name: dayName,
        client_id: clientId || null,
      };
      const result = await Promise.race<CreateResult>([
        api.post<CreateResult>('/movements', payload),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('CREATE_HEADER_TIMEOUT')), 12000);
        }),
      ]);
      if (!result?.id) {
        throw new Error('CREATE_HEADER_INVALID_RESPONSE');
      }
      setMovementId(result.id);
      setOperationNumber(result.operation_number);
      lastSyncedHeaderRef.current = {
        date,
        type,
        clientId: clientId || '',
      };
      fetchDrafts();
      emitDraftSync('draft_created', result.id);
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.includes('CREATE_HEADER_TIMEOUT')) {
        setError('La creación está tardando demasiado. Reintentá; si persiste, refrescá la página.');
      } else if (msg.includes('CREATE_HEADER_INVALID_RESPONSE')) {
        setError('La respuesta al crear operación fue inválida. Reintentá.');
      } else {
        setError(err?.message || 'Error al crear la operación.');
      }
    } finally {
      autoCreateInFlightRef.current = false;
      setCreatingHeader(false);
    }
  }, [
    movementId,
    resumeMovementId,
    date,
    type,
    clientId,
    clientRequired,
    dayName,
    fetchDrafts,
    emitDraftSync,
  ]);

  const patchMovementHeader = useCallback(
    async (confirmClearPayload: boolean) => {
      if (!movementId) return;
      patchSeqRef.current += 1;
      const seq = patchSeqRef.current;

      setError('');
      setPatchingHeader(true);
      if (patchLoadingTimerRef.current) {
        clearTimeout(patchLoadingTimerRef.current);
      }
      // Watchdog UX: avoid stuck "Actualizando cabecera..." if request hangs.
      patchLoadingTimerRef.current = setTimeout(() => {
        if (seq !== patchSeqRef.current) return;
        setPatchingHeader(false);
      }, 5500);
      try {
        await api.patch(`/movements/${movementId}/header`, {
          date,
          type,
          client_id: clientId || null,
          confirm_clear_payload: confirmClearPayload,
        });
        if (seq !== patchSeqRef.current) return;
        lastSyncedHeaderRef.current = {
          date,
          type,
          clientId: clientId || '',
        };
        setConfirmClearOpen(false);
        if (confirmClearPayload) {
          setFormRemountKey((k) => k + 1);
        }
      } catch (err: any) {
        if (seq !== patchSeqRef.current) return;
        const code = err?.error || err?.code;
        if (code === 'PAYLOAD_CLEAR_CONFIRMATION_REQUIRED') {
          setConfirmClearOpen(true);
          return;
        }
        setError(err?.message || 'No se pudo actualizar la cabecera del borrador.');
      } finally {
        if (seq === patchSeqRef.current) {
          if (patchLoadingTimerRef.current) {
            clearTimeout(patchLoadingTimerRef.current);
            patchLoadingTimerRef.current = null;
          }
          setPatchingHeader(false);
        }
      }
    },
    [movementId, date, type, clientId],
  );

  useEffect(() => {
    if (movementId || resumeMovementId) return;
    if (!date || !type) return;
    if (clientRequired && !clientId) return;
    if (autoCreateDebounceRef.current) clearTimeout(autoCreateDebounceRef.current);
    autoCreateDebounceRef.current = setTimeout(() => {
      ensureMovementHeader();
    }, 450);
    return () => {
      if (autoCreateDebounceRef.current) clearTimeout(autoCreateDebounceRef.current);
    };
  }, [date, type, clientId, clientRequired, movementId, resumeMovementId, dayName, ensureMovementHeader]);

  useEffect(() => {
    if (!movementId) return;
    if (confirmClearOpen) return;
    const last = lastSyncedHeaderRef.current;
    if (!last) return;
    const cur = { date, type, clientId: clientId || '' };
    if (last.date === cur.date && last.type === cur.type && last.clientId === cur.clientId) return;
    if (patchDebounceRef.current) clearTimeout(patchDebounceRef.current);
    patchDebounceRef.current = setTimeout(() => {
      patchMovementHeader(false);
    }, 380);
    return () => {
      if (patchDebounceRef.current) clearTimeout(patchDebounceRef.current);
    };
  }, [date, type, clientId, movementId, confirmClearOpen, patchMovementHeader]);

  function handleDone() {
    clearDraftSession();
    fetchDrafts();
    if (movementId) emitDraftSync('draft_deleted', movementId);
    navigate(`/movimientos/${movementId}`);
  }

  async function handleCancelDraft() {
    if (movementId) {
      try {
        await api.delete(`/movements/${movementId}/discard-draft`);
        emitDraftSync('draft_deleted', movementId);
      } catch (err: any) {
        setError(err?.message || 'No se pudo descartar el borrador.');
        return;
      }
    }
    clearDraftSession();
    resetWizard();
    fetchDrafts();
    navigate('/nueva-operacion');
  }

  function movementTypeLabel(value: string): string {
    return MOVEMENT_TYPES.find((t) => t.value === value)?.label || value;
  }

  function handleResumeDraft(draft: DraftListItem) {
    setMovementId(draft.id);
    setOperationNumber(draft.operation_number);
    setType(draft.type);
    setDate(draft.date);
    setClientId(draft.client_id || '');
    setClientQuery(draft.client_name || '');
    lastSyncedHeaderRef.current = {
      date: draft.date,
      type: draft.type,
      clientId: draft.client_id || '',
    };
    setError('');
    emitDraftSync('draft_resumed', draft.id);
  }

  async function handleDiscardListedDraft(draftId: string) {
    if (processingDraftId) return;
    setError('');
    setProcessingDraftId(draftId);
    const previousDrafts = drafts;
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
    try {
      await api.delete(`/movements/${draftId}/discard-draft`);
      emitDraftSync('draft_deleted', draftId);
      if (movementId === draftId) {
        clearDraftSession();
        resetWizard();
      }
      fetchDrafts();
    } catch (err: any) {
      setDrafts(previousDrafts);
      setError(err?.message || 'No se pudo eliminar el borrador.');
      fetchDrafts();
    } finally {
      setProcessingDraftId(null);
    }
  }

  function renderOperationForm() {
    if (!movementId || !type) return null;
    const key = `${movementId}-${type}-${formRemountKey}`;
    switch (type) {
      case 'COMPRA':
        return <CompraForm key={key} movementId={movementId} onDone={handleDone} onCancel={handleCancelDraft} />;
      case 'VENTA':
        return <VentaForm key={key} movementId={movementId} onDone={handleDone} onCancel={handleCancelDraft} />;
      case 'ARBITRAJE':
        return <ArbitrajeForm key={key} movementId={movementId} onDone={handleDone} onCancel={handleCancelDraft} />;
      case 'TRANSFERENCIA_ENTRE_CUENTAS':
        return <TransferenciaEntreCuentasForm key={key} movementId={movementId} onDone={handleDone} onCancel={handleCancelDraft} />;
      case 'INGRESO_CAPITAL':
        return <IngresoCapitalForm key={key} movementId={movementId} onDone={handleDone} onCancel={handleCancelDraft} />;
      case 'RETIRO_CAPITAL':
        return <RetiroCapitalForm key={key} movementId={movementId} onDone={handleDone} onCancel={handleCancelDraft} />;
      case 'GASTO':
        return <GastoForm key={key} movementId={movementId} onDone={handleDone} onCancel={handleCancelDraft} />;
      case 'PAGO_CC_CRUZADO':
        return <PagoCCCruzadoForm key={key} movementId={movementId} clientId={clientId} onDone={handleDone} onCancel={handleCancelDraft} />;
      case 'TRANSFERENCIA': {
        const sel = clients.find((c) => c.id === clientId);
        return (
          <TransferenciaForm
            key={key}
            movementId={movementId}
            clientId={clientId}
            clientCcEnabled={sel?.cc_enabled ?? false}
            onDone={handleDone}
            onCancel={handleCancelDraft}
          />
        );
      }
      case 'TRASPASO_DEUDA_CC':
        return <TraspasoDeudaCCForm key={key} movementId={movementId} clientId={clientId} onDone={handleDone} onCancel={handleCancelDraft} />;
      default:
        return <TypeFormStub key={key} type={type} movementId={movementId} onDone={handleDone} />;
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-800 mb-4">
        Nueva operación
        {movementId != null && operationNumber != null && (
          <span className="text-gray-600 font-normal"> — #{operationNumber}</span>
        )}
      </h2>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">Borradores guardados</h3>
          {loadingDrafts && <span className="text-xs text-gray-500">Cargando...</span>}
        </div>
        {drafts.length === 0 ? (
          <p className="text-sm text-gray-500">No hay borradores pendientes.</p>
        ) : (
          <div className="space-y-2">
            {drafts.map((d) => (
              <div key={d.id} className="border border-gray-200 rounded px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <p className="font-medium text-gray-800">
                    #{d.operation_number} - {movementTypeLabel(d.type)}
                  </p>
                  <p className="text-xs text-gray-500">
                    Fecha: {d.date} {d.client_name ? `| Cliente: ${d.client_name}` : ''} | Actualizado: {new Date(d.updated_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleResumeDraft(d)}
                    disabled={processingDraftId === d.id}
                    className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition"
                  >
                    Reanudar
                  </button>
                  <button
                    onClick={() => handleDiscardListedDraft(d.id)}
                    disabled={processingDraftId === d.id}
                    className="px-3 py-1.5 text-xs text-red-600 border border-red-300 rounded hover:bg-red-50 disabled:opacity-50 transition"
                  >
                    {processingDraftId === d.id ? 'Eliminando...' : 'Eliminar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        {resumeNotice && (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {resumeNotice}
          </div>
        )}
        {/* Date */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm"
            />
            {dayName && <span className="text-sm text-gray-500">{dayName}</span>}
          </div>
        </div>

        {/* Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de operación</label>
          <select
            value={type}
            onChange={(e) => {
              const v = e.target.value;
              if (movementId && !v) return;
              setType(v);
              setClientId('');
              setClientQuery('');
              setIsClientOpen(false);
            }}
            className="w-full max-w-sm border border-gray-300 rounded px-3 py-2 text-sm"
          >
            {!movementId && <option value="">— Seleccionar —</option>}
            {MOVEMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Client combobox */}
        {type && clientRequired && (
          <div>
            <div className="flex items-center justify-between max-w-sm mb-1">
              <label className="text-sm font-medium text-gray-700">
                Cliente
              </label>
              {canCreateClient && (
                <button
                  type="button"
                  onClick={() => setIsClientModalOpen(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium transition"
                >
                  + Nuevo cliente
                </button>
              )}
            </div>
            {clientMustHaveCC && !hasEligibleClients && !loadingClients && (
              <p className="text-xs text-red-600 mb-1">No hay clientes con CC habilitada para este tipo de operación.</p>
            )}
            {loadingClients ? (
              <p className="text-sm text-gray-500">Cargando clientes...</p>
            ) : (
              <div ref={comboRef} className="relative w-full max-w-sm">
                <div className="flex">
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="Buscar por nombre o código..."
                    value={clientQuery}
                    onChange={(e) => {
                      setClientQuery(e.target.value);
                      setClientId('');
                      setIsClientOpen(true);
                      setActiveIndex(-1);
                    }}
                    onFocus={() => setIsClientOpen(true)}
                    onKeyDown={handleComboKeyDown}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                  {clientId && (
                    <button
                      type="button"
                      onClick={() => { clearClient(); inputRef.current?.focus(); }}
                      className="ml-1 px-2 text-gray-400 hover:text-gray-600 text-lg"
                      title="Limpiar"
                    >&times;</button>
                  )}
                </div>
                {isClientOpen && (
                  <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded shadow-lg max-h-64 overflow-auto">
                    {filteredClients.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-400">Sin resultados</div>
                    ) : (
                      filteredClients.map((c, idx) => (
                        <div
                          key={c.id}
                          onMouseDown={(e) => { e.preventDefault(); selectClient(c); }}
                          className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                            idx === activeIndex
                              ? 'bg-blue-600 text-white'
                              : c.id === clientId
                                ? 'bg-blue-50 text-blue-700'
                                : 'text-gray-800 hover:bg-gray-100'
                          }`}
                        >
                          #{c.client_code} — {c.last_name}, {c.first_name}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {isClientModalOpen && (
              <ClientFormModal
                client={null}
                onClose={() => setIsClientModalOpen(false)}
                onSaved={async (newId) => {
                  setIsClientModalOpen(false);
                  const freshList = await fetchClients();
                  if (newId) {
                    const created = freshList.find((c: Client) => c.id === newId);
                    if (created) {
                      setClientId(created.id);
                      setClientQuery(clientLabel(created));
                    }
                  }
                }}
              />
            )}
          </div>
        )}

        <p className="text-xs text-gray-500">
          El borrador se crea automáticamente al tener fecha, tipo y cliente (si el tipo lo requiere).
          Podés editar la cabecera mientras esté en BORRADOR.
        </p>
        {(creatingHeader || patchingHeader) && (
          <p className="text-xs text-blue-600">{creatingHeader ? 'Creando borrador…' : 'Actualizando cabecera…'}</p>
        )}

        {movementId && type && (
          <div className="border-t border-gray-200 pt-4 mt-2">
            {renderOperationForm()}
          </div>
        )}
      </div>

      {confirmClearOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="modal-panel max-w-md w-full p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] space-y-4">
            <p className="text-sm text-gray-800">
              Hay datos guardados en el borrador. Para cambiar el tipo o el cliente hay que descartarlos. ¿Continuar?
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn-touch border border-gray-300 rounded-md hover:bg-gray-50"
                onClick={revertHeaderToLastSynced}
              >
                Volver
              </button>
              <button
                type="button"
                className="btn-touch bg-blue-600 text-white rounded-md hover:bg-blue-700"
                onClick={() => patchMovementHeader(true)}
              >
                Descartar datos y aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TypeFormStub({ type, movementId, onDone }: { type: string; movementId: string; onDone: () => void }) {
  const label = MOVEMENT_TYPES.find((t) => t.value === type)?.label || type;

  return (
    <div className="border-t pt-4">
      <p className="text-gray-500 text-sm mb-4">
        Formulario de <strong>{label}</strong> — próximamente.
      </p>
      <p className="text-xs text-gray-400 mb-4">Movement ID: {movementId}</p>
      <button
        onClick={onDone}
        className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition"
      >
        Ver movimiento
      </button>
    </div>
  );
}
