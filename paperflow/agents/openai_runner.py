from __future__ import annotations

from pathlib import Path
from typing import Any

from paperflow.models import StepResult
from paperflow.workflow import WorkflowContext


class OpenAIRunner:
    def __init__(self, root: Path, config: dict[str, Any]) -> None:
        self.root = root
        self.model = config.get("model", "gpt-4.1")
        self.temperature = config.get("temperature", 0.2)
        self.system_prompt = config.get(
            "system_prompt",
            "你是一名严格、保守、以证据为先的学术写作与审稿助手。",
        )
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise RuntimeError(
                "openai package is not installed. Run 'pip install -r requirements.txt' before using openai steps."
            ) from exc
        self.client = OpenAI()

    def run(self, step: dict[str, Any], context: WorkflowContext, scope: dict[str, list[str]]) -> StepResult:
        del scope
        prompt_body = context.read_text(step["prompt"])
        input_context = context.describe_inputs(step)
        prompt = f"""请严格根据给定输入完成任务。

规则：
1. 优先引用输入中的明确事实。
2. 如果某条实现细节在代码证据中无法确认，明确标记为待确认。
3. 不要把推测写成既定事实。

===== 任务说明 =====
{prompt_body}

===== 输入上下文 =====
{input_context or "<none>"}
"""
        response = self.client.chat.completions.create(
            model=self.model,
            temperature=self.temperature,
            messages=[
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": prompt},
            ],
        )
        text = response.choices[0].message.content or ""
        metadata = {
            "status": "ok",
            "model": self.model,
            "usage": getattr(response, "usage", None).model_dump() if getattr(response, "usage", None) else None,
        }
        return StepResult(prompt=prompt, raw_output=text, metadata=metadata)
