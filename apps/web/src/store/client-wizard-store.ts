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

/** 向导模式：CREATE 从零建档；APPEND 命中已存在客户后，仅追加代理信息，主体标识字段锁定。 */
export type WizardMode = 'CREATE' | 'APPEND';

interface ClientWizardState {
  current: number;
  mode: WizardMode;
  /** APPEND 模式下命中的已存在客户 id；CREATE 模式为 null。 */
  existingClientId: string | null;
  /** APPEND 模式下该客户已有的 (country, agentCompany) 组合，供代理信息步骤禁用重复选项。 */
  existingAgentCombos: Set<string>;
  /**
   * APPEND 模式下该客户已有的代理信息摘要（查重接口出于隐私考虑只返回最小字段，见
   * `ClientsService.checkDuplicate`），仅用于代理信息步骤展示提示，不是完整数据，不可编辑。
   */
  existingAgentInfos: DuplicateCheckAgentInfo[];
  clientType: ClientType | null;
  phone: string;
  email?: string;
  remark?: string;
  companyInfo: Partial<CompanyInfoPayload>;
  legalRepInfo: Partial<LegalRepresentativePayload>;
  agentInfos: AgentInfoDraft[];
  /** OCR 识别是否失败过，用于在表单顶部展示统一提醒语。 */
  ocrFailedHint: boolean;
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
  setBusinessLicenseFile: (file: File) => void;
  setIdCardFile: (side: 'front' | 'back', file: File) => void;
  /**
   * 命中已存在客户时调用：切换到 APPEND 模式，仅记录已存在客户的 id 及其现有代理信息
   * （用于只读展示 + 禁用重复的 country/agentCompany 组合）。
   *
   * 注意：不会覆盖当前表单里已经填写/识别的 companyInfo/legalRepInfo/phone/email —— 因为
   * 统一信用代码/身份证号永远不变，但营业执照/身份证及其余信息可能有更新，本次识别到的最新内容
   * 才是要保存的值，旧记录仅供参照展示，不应回填覆盖当前表单。
   */
  hydrateFromExisting: (client: { id: string; agentInfos: DuplicateCheckAgentInfo[] }) => void;
  reset: () => void;
}

const initialState = {
  current: 0,
  mode: 'CREATE' as WizardMode,
  existingClientId: null as string | null,
  existingAgentCombos: new Set<string>(),
  existingAgentInfos: [] as DuplicateCheckAgentInfo[],
  clientType: null as ClientType | null,
  phone: '',
  email: undefined as string | undefined,
  remark: undefined as string | undefined,
  companyInfo: {} as Partial<CompanyInfoPayload>,
  legalRepInfo: {} as Partial<LegalRepresentativePayload>,
  agentInfos: [] as AgentInfoDraft[],
  ocrFailedHint: false,
  businessLicenseFile: null as File | null,
  idCardFrontFile: null as File | null,
  idCardBackFile: null as File | null,
};

/** 新建客户向导的全局草稿态；4 个 Step 组件共享同一份 store，最终一次性提交给 `/api/clients`（或追加接口）。 */
export const useClientWizardStore = create<ClientWizardState>((set) => ({
  ...initialState,
  setCurrent: (step) => set({ current: step }),
  setClientType: (type) => set({ clientType: type }),
  setContact: (fields) => set((s) => ({ ...s, ...fields })),
  setCompanyInfo: (fields) => set((s) => ({ companyInfo: { ...s.companyInfo, ...fields } })),
  setLegalRepInfo: (fields) => set((s) => ({ legalRepInfo: { ...s.legalRepInfo, ...fields } })),
  setAgentInfos: (agentInfos) => set({ agentInfos }),
  markOcrFailed: () => set({ ocrFailedHint: true }),
  setBusinessLicenseFile: (file) => set({ businessLicenseFile: file }),
  setIdCardFile: (side, file) =>
    set(side === 'front' ? { idCardFrontFile: file } : { idCardBackFile: file }),
  hydrateFromExisting: (client) =>
    set({
      mode: 'APPEND',
      existingClientId: client.id,
      existingAgentCombos: new Set(client.agentInfos.map((a) => `${a.country}:${a.agentCompany}`)),
      existingAgentInfos: client.agentInfos,
      // 对应 ClientWizardPage 的 WIZARD_STEP.AGENT_INFO：主体/法人信息已回填，直接跳到代理信息步骤
      current: 3,
    }),
  reset: () => set({ ...initialState, existingAgentCombos: new Set(), existingAgentInfos: [] }),
}));
