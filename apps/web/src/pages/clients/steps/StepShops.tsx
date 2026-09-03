import { Button, Collapse, Empty } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { AGENT_COUNTRY_COMPANIES } from '@funtax/shared';
import {
  nextKey,
  useClientWizardStore,
  type AgentInfoDraft,
} from '../../../store/client-wizard-store';
import { AgentInfoEditor } from './AgentInfoEditor';

function createEmptyAgentInfo(): AgentInfoDraft {
  return {
    key: nextKey(),
    country: 'GB',
    expectedEffectiveDate: '',
    agentYears: 1,
    agentCompany: AGENT_COUNTRY_COMPANIES.GB[0] ?? 'OVERSEA_WALKERS_GB',
    shops: [],
  };
}

/** Step4：代理信息，一个客户下可添加多条代理信息，每条代理信息内含多个店铺（店铺下再含产品明细，均可多条）。 */
export function StepShops() {
  const agentInfos = useClientWizardStore((s) => s.agentInfos);
  const setAgentInfos = useClientWizardStore((s) => s.setAgentInfos);

  const addAgentInfo = () => setAgentInfos([...agentInfos, createEmptyAgentInfo()]);
  const removeAgentInfo = (key: string) => setAgentInfos(agentInfos.filter((a) => a.key !== key));
  const updateAgentInfo = (key: string, next: AgentInfoDraft) =>
    setAgentInfos(agentInfos.map((a) => (a.key === key ? next : a)));

  return (
    <div>
      {agentInfos.length === 0 ? (
        <Empty description="尚未添加代理信息" style={{ marginBottom: 16 }} />
      ) : (
        <Collapse
          defaultActiveKey={agentInfos.map((a) => a.key)}
          items={agentInfos.map((agentInfo, index) => ({
            key: agentInfo.key,
            label: `代理信息 ${index + 1}`,
            extra: (
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  removeAgentInfo(agentInfo.key);
                }}
              />
            ),
            children: (
              <AgentInfoEditor
                agentInfo={agentInfo}
                onChange={(next) => updateAgentInfo(agentInfo.key, next)}
              />
            ),
          }))}
          style={{ marginBottom: 16 }}
        />
      )}
      <Button type="dashed" block icon={<PlusOutlined />} onClick={addAgentInfo}>
        新增代理信息
      </Button>
    </div>
  );
}
