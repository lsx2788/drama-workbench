import type { PromptVersion, PromptLayers } from "@/shared/agent-prompt";

export function SystemCapabilities({ layers }: { layers: PromptLayers }) {
  return (
    <section className="ai-config-section">
      <h3>系统必备 · 只读</h3>
      <ul className="ai-capability-list">
        {layers.system.requiredTools.map((tool) => (
          <li key={tool.id}>
            <span>{tool.name}</span>
            <small>
              {tool.status === "available" ? "基础接口已提供" : "尚未接入"}
            </small>
          </li>
        ))}
      </ul>
      <h4>系统 Skill</h4>
      {layers.system.requiredSkills.length ? (
        <ul>
          {layers.system.requiredSkills.map((skill) => (
            <li key={skill.id}>
              {skill.name} · v{skill.version}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">当前未配置系统必备 Skill。</p>
      )}
      <p className="muted">
        必备能力由平台提供；本次实际调用的能力与输入可在聊天的 AI 执行记录中查看。
      </p>
    </section>
  );
}

export function PromptLayerView({ snapshot }: { snapshot: PromptVersion }) {
  if (!snapshot.layers)
    return (
      <>
        <p className="muted">历史原始提示词 · 当时尚未分层</p>
        <pre className="prompt-snapshot">
          {snapshot.instructions || "此版本未配置提示词"}
        </pre>
      </>
    );
  return (
    <>
      <h3>内容提示词</h3>
      <pre className="prompt-snapshot">
        {snapshot.instructions || "未填写自定义内容"}
      </pre>
      <details className="ai-config-section">
        <summary>
          系统规则 · {snapshot.layers.system.id} v
          {snapshot.layers.system.version} · 只读
        </summary>
        <pre className="prompt-snapshot">
          {snapshot.layers.system.instructions}
        </pre>
      </details>
      <SystemCapabilities layers={snapshot.layers} />
      <section className="ai-config-section">
        <h3>当时的用户选配</h3>
        <p>{snapshot.layers.optionalTools.join("、") || "未选择扩展工具"}</p>
        <ul>
          {snapshot.layers.optionalSkills.map((skill) => (
            <li key={skill.id}>
              {skill.name} · v{skill.version}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
