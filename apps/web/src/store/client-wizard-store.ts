import { create } from 'zustand';
import type {
  AgentInfoPayload,
  ClientType,
  CompanyInfoPayload,
  LegalRepresentativePayload,
  ProductPayload,
  ShopPayload,
} from '@funtax/shared';

let uidSeq = 0;
/** 向导内新增行（店铺/产品/代理）的本地 key 生成器，仅用于 UI 增删定位，提交时剥离。 */
export const nextKey = () => `k${Date.now()}-${uidSeq++}`;

/** 向导内的店铺草稿，携带本地 id 便于 UI 增删；提交时剥离掉 `key`。 */
export interface ShopDraft extends ShopPayload {
  key: string;
  products: (ProductPayload & { key: string })[];
  agentInfos: (AgentInfoPayload & { key: string })[];
}

interface ClientWizardState {
  current: number;
  clientType: ClientType | null;
  phone: string;
  email?: string;
  remark?: string;
  companyInfo: Partial<CompanyInfoPayload>;
  legalRepInfo: Partial<LegalRepresentativePayload>;
  shops: ShopDraft[];
  /** OCR 识别是否失败过，用于在表单顶部展示统一提醒语。 */
  ocrFailedHint: boolean;

  setCurrent: (step: number) => void;
  setClientType: (type: ClientType) => void;
  setContact: (fields: { phone?: string; email?: string; remark?: string }) => void;
  setCompanyInfo: (fields: Partial<CompanyInfoPayload>) => void;
  setLegalRepInfo: (fields: Partial<LegalRepresentativePayload>) => void;
  setShops: (shops: ShopDraft[]) => void;
  markOcrFailed: () => void;
  reset: () => void;
}

const initialState = {
  current: 0,
  clientType: null as ClientType | null,
  phone: '',
  email: undefined as string | undefined,
  remark: undefined as string | undefined,
  companyInfo: {} as Partial<CompanyInfoPayload>,
  legalRepInfo: {} as Partial<LegalRepresentativePayload>,
  shops: [] as ShopDraft[],
  ocrFailedHint: false,
};

/** 新建客户向导的全局草稿态；4 个 Step 组件共享同一份 store，最终一次性提交给 `/api/clients`。 */
export const useClientWizardStore = create<ClientWizardState>((set) => ({
  ...initialState,
  setCurrent: (step) => set({ current: step }),
  setClientType: (type) => set({ clientType: type }),
  setContact: (fields) => set((s) => ({ ...s, ...fields })),
  setCompanyInfo: (fields) => set((s) => ({ companyInfo: { ...s.companyInfo, ...fields } })),
  setLegalRepInfo: (fields) => set((s) => ({ legalRepInfo: { ...s.legalRepInfo, ...fields } })),
  setShops: (shops) => set({ shops }),
  markOcrFailed: () => set({ ocrFailedHint: true }),
  reset: () => set({ ...initialState }),
}));
