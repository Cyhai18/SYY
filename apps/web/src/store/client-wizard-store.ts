import { create } from 'zustand';
import type {
  AgentCountry,
  AgentInfoPayload,
  ClientType,
  CompanyInfoPayload,
  DuplicateCheckAgentInfo,
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
}

/** 向导内的代理信息草稿：一条代理信息可覆盖多个店铺。 */
export interface AgentInfoDraft extends AgentInfoPayload {
  key: string;
  shops: ShopDraft[];
}

/** 向导模式：CREATE 从零建档；APPEND 命中已存在客户后，仅追加代理信息，主体标识字段锁定。 */
export type WizardMode = 'CREATE' | 'APPEND';

interface ClientWizardState {
  current: number;
  mode: WizardMode;
  /** APPEND 模式下命中的已存在客户 id；CREATE 模式为 null。 */
  existingClientId: string | null;
  clientType: ClientType | null;
  phone: string;
  email?: string;
  remark?: string;
  companyInfo: Partial<CompanyInfoPayload>;
  legalRepInfo: Partial<LegalRepresentativePayload>;
  agentInfos: AgentInfoDraft[];
  /** APPEND 模式下命中的已存在客户已有的代理信息摘要（不含店铺明细），用于代理信息步骤
   * 禁用已占用的代理国家选项；CREATE 模式恒为空数组。 */
  existingAgentInfos: DuplicateCheckAgentInfo[];
  /** OCR 识别是否失败过，用于在表单顶部展示统一提醒语（长期状态，不随提示条自动消失而复位）。 */
  ocrFailedHint: boolean;
  /** `ocrFailedHint` 提示条当前是否展示：置真后 10s 自动隐藏，或手动关闭；计时器挂在 store
   * 而非某个 Step 组件上，避免用户切换步骤导致组件卸载重挂载时提示又被重新触发展示。 */
  ocrFailedHintVisible: boolean;
  /** APPEND 模式"该客户已存在..."提示条当前是否展示，语义/生命周期同 `ocrFailedHintVisible`。 */
  lockedHintVisible: boolean;
  /** 向导内上传的原始图片，识别完不落盘，提交时随 multipart 一并交给后端持久化，见 client-batch-import-design.md 第 5.2 节。 */
  businessLicenseFile: File | null;
  idCardFrontFile: File | null;
  idCardBackFile: File | null;

  setCurrent: (step: number) => void;
  setClientType: (type: ClientType) => void;
  setContact: (fields: { phone?: string; email?: string; remark?: string }) => void;
  setCompanyInfo: (fields: Partial<CompanyInfoPayload>) => void;
  setLegalRepInfo: (fields: Partial<LegalRepresentativePayload>) => void;
  setAgentInfos: (agentInfos: AgentInfoDraft[]) => void;
  markOcrFailed: () => void;
  dismissOcrFailedHint: () => void;
  dismissLockedHint: () => void;
  setBusinessLicenseFile: (file: File) => void;
  setIdCardFile: (side: 'front' | 'back', file: File) => void;
  clearBusinessLicenseFile: () => void;
  clearIdCardFile: (side: 'front' | 'back') => void;
  /**
   * 命中已存在客户时调用：切换到 APPEND 模式，记录已存在客户的 id，并把其 companyInfo/
   * legalRepInfo/联系方式回填到当前表单——统一信用代码/身份证号已禁止手动编辑，命中说明其余信息
   * 大概率也不用重填，减少用户重复录入；后续如证件重新上传识别到更新内容，会再次覆盖回填值。
   */
  hydrateFromExisting: (client: {
    id: string;
    phone?: string;
    email?: string;
    remark?: string;
    companyInfo?: CompanyInfoPayload;
    legalRepInfo?: LegalRepresentativePayload;
    agentInfos?: DuplicateCheckAgentInfo[];
  }) => void;
  reset: () => void;
}

const initialState = {
  current: 0,
  mode: 'CREATE' as WizardMode,
  existingClientId: null as string | null,
  clientType: null as ClientType | null,
  phone: '',
  email: undefined as string | undefined,
  remark: undefined as string | undefined,
  companyInfo: {} as Partial<CompanyInfoPayload>,
  legalRepInfo: {} as Partial<LegalRepresentativePayload>,
  agentInfos: [] as AgentInfoDraft[],
  existingAgentInfos: [] as DuplicateCheckAgentInfo[],
  ocrFailedHint: false,
  ocrFailedHintVisible: false,
  lockedHintVisible: false,
  businessLicenseFile: null as File | null,
  idCardFrontFile: null as File | null,
  idCardBackFile: null as File | null,
};

/** 提示条自动隐藏的定时器 id，挂在模块作用域而非 store state 里（无需触发订阅者重渲染）；
 * 每次重新展示前清掉上一个，避免重复触发或内存泄漏。 */
/** 合并 OCR 部分识别结果/反面上传等场景返回的字段前，先剔除值为 `undefined` 的 key——对象展开
 * 语法只要源对象显式包含某 key（哪怕值是 `undefined`）就会覆盖目标同名 key 的已有值，
 * 否则会把之前已识别/手填的字段静默清空。 */
function stripUndefined<T extends object>(fields: Partial<T>): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(fields) as (keyof T)[]) {
    if (fields[key] !== undefined) result[key] = fields[key];
  }
  return result;
}

let ocrFailedHintTimer: ReturnType<typeof setTimeout> | null = null;
let lockedHintTimer: ReturnType<typeof setTimeout> | null = null;
const HINT_AUTO_HIDE_MS = 10000;

/** 新建客户向导的全局草稿态；4 个 Step 组件共享同一份 store，最终一次性提交给 `/api/clients`（或追加接口）。 */
export const useClientWizardStore = create<ClientWizardState>((set) => ({
  ...initialState,
  setCurrent: (step) => set({ current: step }),
  setClientType: (type) => set({ clientType: type }),
  setContact: (fields) => set((s) => ({ ...s, ...fields })),
  setCompanyInfo: (fields) =>
    set((s) => ({ companyInfo: { ...s.companyInfo, ...stripUndefined(fields) } })),
  setLegalRepInfo: (fields) =>
    set((s) => ({ legalRepInfo: { ...s.legalRepInfo, ...stripUndefined(fields) } })),
  setAgentInfos: (agentInfos) => set({ agentInfos }),
  markOcrFailed: () => {
    if (ocrFailedHintTimer) clearTimeout(ocrFailedHintTimer);
    ocrFailedHintTimer = setTimeout(() => set({ ocrFailedHintVisible: false }), HINT_AUTO_HIDE_MS);
    set({ ocrFailedHint: true, ocrFailedHintVisible: true });
  },
  dismissOcrFailedHint: () => {
    if (ocrFailedHintTimer) clearTimeout(ocrFailedHintTimer);
    set({ ocrFailedHintVisible: false });
  },
  dismissLockedHint: () => {
    if (lockedHintTimer) clearTimeout(lockedHintTimer);
    set({ lockedHintVisible: false });
  },
  setBusinessLicenseFile: (file) => set({ businessLicenseFile: file }),
  setIdCardFile: (side, file) =>
    set(side === 'front' ? { idCardFrontFile: file } : { idCardBackFile: file }),
  clearBusinessLicenseFile: () => set({ businessLicenseFile: null }),
  clearIdCardFile: (side) =>
    set(side === 'front' ? { idCardFrontFile: null } : { idCardBackFile: null }),
  hydrateFromExisting: (client) => {
    if (lockedHintTimer) clearTimeout(lockedHintTimer);
    lockedHintTimer = setTimeout(() => set({ lockedHintVisible: false }), HINT_AUTO_HIDE_MS);
    set((s) => ({
      mode: 'APPEND',
      existingClientId: client.id,
      phone: client.phone ?? s.phone,
      email: client.email ?? s.email,
      remark: client.remark ?? s.remark,
      companyInfo: client.companyInfo ?? s.companyInfo,
      legalRepInfo: client.legalRepInfo ?? s.legalRepInfo,
      existingAgentInfos: client.agentInfos ?? s.existingAgentInfos,
      lockedHintVisible: true,
      // 对应 ClientWizardPage 的 WIZARD_STEP.AGENT_INFO：主体/法人信息已回填，直接跳到代理信息步骤
      current: 3,
    }));
  },
  reset: () => {
    if (ocrFailedHintTimer) clearTimeout(ocrFailedHintTimer);
    if (lockedHintTimer) clearTimeout(lockedHintTimer);
    set({ ...initialState });
  },
}));
