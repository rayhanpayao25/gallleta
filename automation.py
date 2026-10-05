"""Seed the printed Galleta Café menu into Supabase.

By default this only previews the catalog. Pass --apply to upsert the printed
categories and menu items. Add --replace to also remove other catalog entries.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen


CATEGORIES = [
    {"id": "coffee-drinks", "name": "Coffee Drinks", "sort_order": 0},
    {"id": "non-coffee-drinks", "name": "Non-Coffee Drinks", "sort_order": 1},
    {"id": "soda-pop", "name": "Soda Pop", "sort_order": 2},
    {"id": "matcha-series", "name": "Matcha Series", "sort_order": 3},
    {"id": "snacks", "name": "Snacks", "sort_order": 4},
    {"id": "rice-meals", "name": "Rice Meals", "sort_order": 5},
]

DRINK_ADDONS = [
    {"id": "coffee-shot", "name": "Coffee Shot", "price": 15, "qtyEnabled": False},
    {"id": "oreo", "name": "Oreo", "price": 15, "qtyEnabled": False},
    {"id": "strawberry", "name": "Strawberry", "price": 15, "qtyEnabled": False},
    {"id": "nata-de-coco", "name": "Nata de Coco", "price": 10, "qtyEnabled": False},
    {"id": "sea-salt-cream", "name": "Sea Salt Cream", "price": 25, "qtyEnabled": False},
    {"id": "seaweed-per-pack", "name": "Seaweed (per pack)", "price": 25, "qtyEnabled": False},
]

DRINK_CATEGORY_IDS = {
    "coffee-drinks",
    "non-coffee-drinks",
    "soda-pop",
    "matcha-series",
}

# id, name, category id, prices/sizes
MENU_SOURCE = [
    ("iced-latte", "Iced Latte", "coffee-drinks", [("16oz", 69)]),
    ("spanish-latte", "Spanish Latte", "coffee-drinks", [("16oz", 69)]),
    ("caramel-macchiato", "Caramel Macchiato", "coffee-drinks", [("16oz", 69)]),
    ("hazelnut-latte", "Hazelnut Latte", "coffee-drinks", [("16oz", 69)]),
    ("cinnamon-latte", "Cinnamon Latte", "coffee-drinks", [("16oz", 69)]),
    ("sea-salt-latte", "Sea Salt Latte", "coffee-drinks", [("16oz", 79)]),
    ("milo-dino", "Milo Dino", "non-coffee-drinks", [("16oz", 59)]),
    ("iced-chocolate", "Iced Chocolate", "non-coffee-drinks", [("16oz", 59)]),
    ("choco-oreo", "Choco Oreo", "non-coffee-drinks", [("16oz", 59)]),
    ("choco-berry", "Choco Berry", "non-coffee-drinks", [("16oz", 59)]),
    ("strawberry-milk", "Strawberry Milk", "non-coffee-drinks", [("16oz", 59)]),
    ("soda-green-apple", "Green Apple", "soda-pop", [("16oz", 49)]),
    ("soda-blueberry", "Blueberry", "soda-pop", [("16oz", 49)]),
    ("soda-strawberry", "Strawberry", "soda-pop", [("16oz", 49)]),
    ("soda-lychee", "Lychee", "soda-pop", [("16oz", 49)]),
    ("milky-matcha", "Milky Matcha", "matcha-series", [("16oz", 69)]),
    ("matcha-oreo", "Matcha Oreo", "matcha-series", [("16oz", 69)]),
    ("matcha-berry", "Matcha Berry", "matcha-series", [("16oz", 69)]),
    ("cheesy-fries", "Cheesy Fries", "snacks", [("1 order", 69)]),
    ("regular-fries", "Regular Fries", "snacks", [("1 order", 49)]),
    ("nachos", "Nachos", "snacks", [("1 order", 69)]),
    ("siomai", "Siomai", "snacks", [("1 order", 49)]),
    ("tempura", "Tempura", "snacks", [("1 order", 49)]),
    ("squidballs", "Squidballs", "snacks", [("1 order", 49)]),
    ("tapsilog", "Tapsilog", "rice-meals", [("1 order", 109)]),
    ("tocilog", "Tocilog", "rice-meals", [("1 order", 99)]),
    ("hungarian-silog", "Hungarian Silog", "rice-meals", [("1 order", 109)]),
    ("chicken-wings", "Chicken Wings", "rice-meals", [("2pcs", 79), ("3pcs", 99)]),
]


def load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, value = line.partition("=")
        if not separator:
            continue
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def build_menu_rows() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for sort_order, (item_id, name, category_id, size_prices) in enumerate(MENU_SOURCE):
        sizes = [{"label": label, "price": price} for label, price in size_prices]
        rows.append(
            {
                "id": item_id,
                "name": name,
                "price": size_prices[0][1],
                "category_id": category_id,
                "image": "/images/logo.jpg",
                "available": True,
                "styles": [],
                "addons": DRINK_ADDONS if category_id in DRINK_CATEGORY_IDS else [],
                "sizes": sizes,
                "sort_order": sort_order,
            }
        )
    return rows


def request_supabase(
    base_url: str,
    api_key: str,
    path: str,
    *,
    method: str = "GET",
    body: object | None = None,
    prefer: str | None = None,
) -> object:
    headers = {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    request = Request(f"{base_url}/rest/v1/{path}", data=payload, headers=headers, method=method)
    try:
        with urlopen(request, timeout=30) as response:
            response_text = response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase returned HTTP {error.code}: {detail}") from None
    except URLError as error:
        raise RuntimeError(f"Could not connect to Supabase: {error.reason}") from None

    if not response_text:
        return None
    return json.loads(response_text)


def sync_menu(apply: bool, replace_catalog: bool = False) -> None:
    menu_rows = build_menu_rows()
    print(f"Menu preview: {len(CATEGORIES)} categories, {len(menu_rows)} items")
    for category in CATEGORIES:
        names = [row["name"] for row in menu_rows if row["category_id"] == category["id"]]
        print(f"- {category['name']} ({len(names)}): {', '.join(str(name) for name in names)}")
    if not apply:
        print("\nDry run only. Add --apply to write this catalog to Supabase.")
        if replace_catalog:
            print("--replace will also remove other menu categories and items.")
        return

    root = Path(__file__).resolve().parent
    load_env_file(root / ".env.local")
    load_env_file(root / ".env")
    base_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    api_key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    if not base_url or not api_key:
        raise RuntimeError(
            "Missing SUPABASE_URL or SUPABASE_SECRET_KEY. Set them in the environment, "
            ".env, or .env.local."
        )
    parsed_url = urlsplit(base_url)
    if (
        parsed_url.scheme != "https"
        or not parsed_url.hostname
        or not parsed_url.hostname.endswith(".supabase.co")
        or parsed_url.path
        or parsed_url.query
        or parsed_url.fragment
    ):
        raise RuntimeError("SUPABASE_URL must be an https://<project-ref>.supabase.co URL.")

    request_supabase(
        base_url,
        api_key,
        "menu_categories?on_conflict=id",
        method="POST",
        body=CATEGORIES,
        prefer="resolution=merge-duplicates,return=minimal",
    )
    request_supabase(
        base_url,
        api_key,
        "menu_items?on_conflict=id",
        method="POST",
        body=menu_rows,
        prefer="resolution=merge-duplicates,return=minimal",
    )

    if replace_catalog:
        menu_ids = ",".join(row["id"] for row in menu_rows)
        category_ids = ",".join(row["id"] for row in CATEGORIES)
        menu_filter = urlencode({"id": f"not.in.({menu_ids})"})
        category_filter = urlencode({"id": f"not.in.({category_ids})"})
        request_supabase(
            base_url,
            api_key,
            f"menu_items?{menu_filter}",
            method="DELETE",
            prefer="return=minimal",
        )
        request_supabase(
            base_url,
            api_key,
            f"menu_categories?{category_filter}",
            method="DELETE",
            prefer="return=minimal",
        )
    print("\nSupabase menu sync complete.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="upsert the printed menu categories and items",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="with --apply, also remove categories/items not in the printed menu",
    )
    args = parser.parse_args()
    if args.replace and not args.apply:
        parser.error("--replace requires --apply")
    try:
        sync_menu(args.apply, args.replace)
    except RuntimeError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
