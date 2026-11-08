import { create } from 'zustand';
import type {
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

/**
 * 向导模式：CREATE 从零建档；APPEND 命中已存在客户后追加代理信息。
 * APPEND 下唯一标识仍可编辑：若用户改成与锁定值不同的号码，则退出 APPEND 按新建重新查重
 * （避免误点追加后无法改为「新建另一客户」）。
 */
export type WizardMode = 'CREATE' | 'APPEND';

export interface ClientWizardState {
  current: number;
  mode: WizardMode;
  /** APPEND 模式下命中的已存在客户 id；CREATE 模式为 null。 */
  existingClientId: string | null;
  /**
   * 进入 APPEND 时固化的唯一标识（已规范化）。
   * 用于判断用户是否改号：与当前输入不一致则 exitAppendMode。
   */
  lockedUniqueIdentifier: string | null;
  clientType: ClientType | null;
  phone: string;
  email?: string;
  remark?: string;
  companyInfo: Partial<CompanyInfoPayload>;
  legalRepInfo: Partial<LegalRepresentativePayload>;
  agentInfos: AgentInfoDraft[];
  /** APPEND 模式下命中的已存在客户已有的代理信息（含店铺/产品明细），用于代理信息步骤
   * 禁用已占用的代理国家选项、只读展示已有代理信息卡片，并在新增其他国家代理信息时
   * 默认复用其店铺数据；CREATE 模式恒为空数组。 */
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
  replaceCompanyOcrFields: (fields?: Partial<CompanyInfoPayload>) => void;
  setLegalRepInfo: (fields: Partial<LegalRepresentativePayload>) => void;
  replaceIdOcrFields: (fields?: Partial<LegalRepresentativePayload>) => void;
  setAgentInfos: (agentInfos: AgentInfoDraft[]) => void;
  markOcrFailed: () => void;
  dismissOcrFailedHint: () => void;
  dismissLockedHint: () => void;
  /**
   * 查重命中"归属其他用户"被阻断时调用：清空本次 OCR 识别回填的主体/法人信息及已上传的证件文件，
   * 强制用户重新上传证件，避免带着被拦截的统一信用代码/身份证号直接进入下一步、到最终提交才报错。
   */
  clearRecognizedIdentity: (target: 'company' | 'legalRep') => void;
  setBusinessLicenseFile: (file: File) => void;
  setIdCardFile: (side: 'front' | 'back', file: File) => void;
  clearBusinessLicenseFile: () => void;
  clearIdCardFile: (side: 'front' | 'back') => void;
  /**
   * 命中已存在客户时调用：切换到 APPEND 模式，记录已存在客户的 id 与锁定唯一标识，
   * 并把其 companyInfo/legalRepInfo/联系方式回填到当前表单。
   * 唯一标识仍可编辑；若用户改成其它号码，调用 exitAppendMode 回到 CREATE 重新查重。
   */
  hydrateFromExisting: (client: {
    id: string;
    phone?: string;
    email?: string;
    remark?: string;
    companyInfo?: CompanyInfoPayload;
    legalRepInfo?: LegalRepresentativePayload;
    agentInfos?: DuplicateCheckAgentInfo[];
    /** 已规范化的唯一标识（信用代码或身份证号） */
    lockedUniqueIdentifier: string;
  }) => void;
  /**
   * 用户改动唯一标识后退出追加：清掉 existingClientId / existingAgentInfos / 锁定标识，
   * 回到主体信息步骤继续当新建客户填写；保留当前表单其它已填内容。
   */
  exitAppendMode: (opts?: { returnToStep?: number }) => void;
  /**
   * 从服务端草稿复原：只恢复可序列化字段；证件 File / 提示条始终回到初始空态。
   * 调用方负责在复原后同步 antd Form 的 setFieldsValue。
   */
  hydrateFromDraft: (payload: WizardDraftSnapshot) => void;
  reset: () => void;
}

/**
 * 写入服务端草稿的快照形状（与 hydrateFromDraft 对称）。
 * 不含 File、OCR/锁定提示条等瞬时 UI 态。
 */
export interface WizardDraftSnapshot {
  current?: number;
  mode?: WizardMode;
  existingClientId?: string | null;
  lockedUniqueIdentifier?: string | null;
  clientType?: ClientType | null;
  phone?: string;
  email?: string;
  remark?: string;
  companyInfo?: Partial<CompanyInfoPayload>;
  legalRepInfo?: Partial<LegalRepresentativePayload>;
  agentInfos?: AgentInfoDraft[];
  existingAgentInfos?: DuplicateCheckAgentInfo[];
}

const initialState = {
  current: 0,
  mode: 'CREATE' as WizardMode,
  existingClientId: null as string | null,
  lockedUniqueIdentifier: null as string | null,
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

let ocrFailedHintTimer: ReturnType<typeof setTimeout> | null = null;
let lockedHintTimer: ReturnType<typeof setTimeout> | null = null;
const HINT_AUTO_HIDE_MS = 10000;

/** 每次更换营业执照完整替换这组字段；联系方式不属于证照识别结果。 */
export const COMPANY_OCR_FIELDS = [
  'creditCode',
  'nameCn',
  'nameEn',
  'postalCode',
  'addressCn',
  'addressEn',
  'provinceEn',
  'cityEn',
] as const satisfies readonly (keyof CompanyInfoPayload)[];

export function companyOcrValues(fields: Partial<CompanyInfoPayload> = {}) {
  return Object.fromEntries(COMPANY_OCR_FIELDS.map((key) => [key, fields[key] ?? ''])) as Record<
    (typeof COMPANY_OCR_FIELDS)[number],
    string
  >;
}

export const ID_OCR_FIELDS = [
  'idNumber',
  'nameCn',
  'namePinyin',
  'idPostalCode',
  'idAddressCn',
  'idAddressEn',
] as const satisfies readonly (keyof LegalRepresentativePayload)[];

export function idOcrValues(fields: Partial<LegalRepresentativePayload> = {}) {
  return Object.fromEntries(ID_OCR_FIELDS.map((key) => [key, fields[key] ?? ''])) as Record<
    (typeof ID_OCR_FIELDS)[number],
    string
  >;
}

/** 新建客户向导的全局草稿态；4 个 Step 组件共享同一份 store，最终一次性提交给 `/api/clients`（或追加接口）。 */
export const useClientWizardStore = create<ClientWizardState>((set) => ({
  ...initialState,
  setCurrent: (step) => set({ current: step }),
  setClientType: (type) => set({ clientType: type }),
  setContact: (fields) => set(fields),
  setCompanyInfo: (fields) =>
    set((s) => ({ companyInfo: { ...s.companyInfo, ...stripUndefined(fields) } })),
  replaceCompanyOcrFields: (fields) =>
    set((s) => ({ companyInfo: { ...s.companyInfo, ...companyOcrValues(fields) } })),
  setLegalRepInfo: (fields) =>
    set((s) => ({ legalRepInfo: { ...s.legalRepInfo, ...stripUndefined(fields) } })),
  replaceIdOcrFields: (fields) =>
    set((s) => ({ legalRepInfo: { ...s.legalRepInfo, ...idOcrValues(fields) } })),
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
  clearRecognizedIdentity: (target) =>
    set(
      target === 'company'
        ? { companyInfo: {}, businessLicenseFile: null }
        : { legalRepInfo: {}, idCardFrontFile: null, idCardBackFile: null },
    ),
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
      lockedUniqueIdentifier: client.lockedUniqueIdentifier,
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
  exitAppendMode: (opts) => {
    if (lockedHintTimer) clearTimeout(lockedHintTimer);
    // 保留表单已填内容与 agentInfos 草稿；仅清追加态。改号后若指定 returnToStep 则回到主体/个人信息步。
    set({
      mode: 'CREATE',
      existingClientId: null,
      lockedUniqueIdentifier: null,
      existingAgentInfos: [],
      lockedHintVisible: false,
      ...(opts?.returnToStep !== undefined ? { current: opts.returnToStep } : {}),
    });
  },
  hydrateFromDraft: (payload) => {
    if (ocrFailedHintTimer) clearTimeout(ocrFailedHintTimer);
    if (lockedHintTimer) clearTimeout(lockedHintTimer);
    const mode: WizardMode = payload.mode === 'APPEND' ? 'APPEND' : 'CREATE';
    const clientType =
      payload.clientType === 'COMPANY' || payload.clientType === 'INDIVIDUAL'
        ? payload.clientType
        : null;
    set({
      ...initialState,
      current: typeof payload.current === 'number' && payload.current >= 0 ? payload.current : 0,
      mode,
      existingClientId:
        mode === 'APPEND' && typeof payload.existingClientId === 'string'
          ? payload.existingClientId
          : null,
      lockedUniqueIdentifier:
        mode === 'APPEND' && typeof payload.lockedUniqueIdentifier === 'string'
          ? payload.lockedUniqueIdentifier
          : null,
      clientType,
      phone: typeof payload.phone === 'string' ? payload.phone : '',
      email: typeof payload.email === 'string' ? payload.email : undefined,
      remark: typeof payload.remark === 'string' ? payload.remark : undefined,
      companyInfo: isPlainObject(payload.companyInfo)
        ? (payload.companyInfo as Partial<CompanyInfoPayload>)
        : {},
      legalRepInfo: isPlainObject(payload.legalRepInfo)
        ? (payload.legalRepInfo as Partial<LegalRepresentativePayload>)
        : {},
      agentInfos: Array.isArray(payload.agentInfos) ? (payload.agentInfos as AgentInfoDraft[]) : [],
      existingAgentInfos:
        mode === 'APPEND' && Array.isArray(payload.existingAgentInfos)
          ? (payload.existingAgentInfos as DuplicateCheckAgentInfo[])
          : [],
      // 证件与提示条不进草稿，保持 initialState 空值
    });
  },
  reset: () => {
    if (ocrFailedHintTimer) clearTimeout(ocrFailedHintTimer);
    if (lockedHintTimer) clearTimeout(lockedHintTimer);
    set({ ...initialState });
  },
}));

/** 从当前 store 抽出可写入服务端的草稿快照（剥离 File 与瞬时提示态）。 */
export function buildWizardDraftSnapshot(
  state: ClientWizardState = useClientWizardStore.getState(),
): WizardDraftSnapshot {
  return {
    current: state.current,
    mode: state.mode,
    existingClientId: state.existingClientId,
    lockedUniqueIdentifier: state.lockedUniqueIdentifier,
    clientType: state.clientType,
    phone: state.phone,
    email: state.email,
    remark: state.remark,
    companyInfo: state.companyInfo,
    legalRepInfo: state.legalRepInfo,
    agentInfos: state.agentInfos,
    existingAgentInfos: state.existingAgentInfos,
  };
}
