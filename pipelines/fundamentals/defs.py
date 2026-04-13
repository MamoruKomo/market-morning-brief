from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MetricDef:
    key: str
    label: str
    unit: str
    better: str  # "high" | "low"
    decimals: int = 2
    description: str = ""


METRICS: list[MetricDef] = [
    MetricDef(key="roe", label="ROE", unit="%", better="high", decimals=2, description="自己資本利益率"),
    MetricDef(key="roa", label="ROA", unit="%", better="high", decimals=2, description="総資産利益率"),
    MetricDef(key="roic", label="ROIC", unit="%", better="high", decimals=2, description="投下資本利益率"),
    MetricDef(key="operating_margin", label="営業利益率", unit="%", better="high", decimals=2),
    MetricDef(key="net_margin", label="純利益率", unit="%", better="high", decimals=2),
    MetricDef(key="equity_ratio", label="自己資本比率", unit="%", better="high", decimals=2),
    MetricDef(key="dividend_yield", label="配当利回り", unit="%", better="high", decimals=2),
    MetricDef(key="per", label="PER", unit="x", better="low", decimals=2, description="株価収益率（低いほど割安）"),
    MetricDef(key="pbr", label="PBR", unit="x", better="low", decimals=2, description="株価純資産倍率（低いほど割安）"),
]


PAIR_DEFS: list[dict[str, str]] = [
    {"key": "roe_growth", "label": "高ROE×成長", "a": "roe", "b": "sales_growth_yoy"},
    {"key": "div_health", "label": "高配当×健全", "a": "dividend_yield", "b": "equity_ratio"},
    {"key": "margin_roe", "label": "高利益率×ROE", "a": "operating_margin", "b": "roe"},
    {"key": "quality_value", "label": "高ROE×低PBR", "a": "roe", "b": "pbr"},
]

