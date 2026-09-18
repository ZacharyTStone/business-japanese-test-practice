"""The shape of one Messages request, per model family.

No API call is made: `request_params` is the pure function `_structured` hands
to the SDK, and the point of testing it is the first real night, when every
proofread and every difficulty probe failed because the cheap model was asked
in the expensive model's dialect.
"""
from bjt import llm

SCHEMA = {"type": "object", "properties": {"x": {"type": "boolean"}}}


def _params(model):
    return llm.request_params(model, "sys", "user", SCHEMA, max_tokens=1200, effort="low")


def test_opus_and_sonnet_get_adaptive_thinking_and_an_effort():
    for model in ("claude-opus-5", "claude-sonnet-5"):
        p = _params(model)
        assert p["thinking"] == {"type": "adaptive"}
        assert p["output_config"]["effort"] == "low"
        assert p["output_config"]["format"]["schema"] is SCHEMA


def test_haiku_gets_neither_because_it_would_refuse_both():
    p = _params("claude-haiku-4-5")
    assert "thinking" not in p
    assert "effort" not in p["output_config"]
    # Everything else is the same request.
    assert p["model"] == "claude-haiku-4-5"
    assert p["max_tokens"] == 1200
    assert p["output_config"]["format"] == {"type": "json_schema", "schema": SCHEMA}
    assert p["messages"] == [{"role": "user", "content": "user"}]
    assert p["system"] == "sys"


def test_the_default_proofreader_and_probe_model_is_one_haiku_accepts():
    from bjt import config

    assert config.SANITY_MODEL.startswith("claude-haiku")
    assert config.DIFFICULTY_MODEL.startswith("claude-haiku")
    assert "thinking" not in _params(config.SANITY_MODEL)
