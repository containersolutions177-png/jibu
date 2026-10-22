
import os
import logging
import secrets
from datetime import datetime, timezone
from typing import Literal, Optional

import stripe
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("jibu")

app = FastAPI(
    title="Jibu API",
    description="Jibu's modular demo and commerce API",
    version="1.0.0",
)

# Configure exact production origins through FRONTEND_ORIGINS.
# Wildcard origins are only suitable for a public demo.
origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv(
        "FRONTEND_ORIGINS", "*"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


# Vercel can expose the function under /api. Strip that prefix
# while preserving direct /stats, /products, etc. for local use.
@app.middleware("http")
async def normalize_vercel_api_path(request: Request, call_next):
    path = request.scope.get("path", "")
    if path == "/api":
        request.scope["path"] = "/"
    elif path.startswith("/api/"):
        request.scope["path"] = path[4:]
    return await call_next(request)


# ------------------------------------------------------------------
# DEMO DATA
# In-memory only: do not use these collections for durable records.
# ------------------------------------------------------------------

USERS = [
    {
        "id": "u1",
        "name": "Jibu Member",
        "score": 742,
        "tier": "Growing",
        "currency": "ZAR",
        "joined": "2026-01-15",
    },
    {
        "id": "u2",
        "name": "Demo Merchant",
        "score": 680,
        "tier": "Building",
        "currency": "ZAR",
        "joined": "2026-02-10",
    },
]

PRODUCTS = [
    {
        "id": "p1",
        "name": "Jibu Starter Pack",
        "description": "A practical starter bundle for your next step.",
        "price": 149.00,
        "currency": "ZAR",
        "category": "Essentials",
        "stock": 20,
        "image": "",
    },
    {
        "id": "p2",
        "name": "Jibu Growth Kit",
        "description": "Tools and resources for growing your business.",
        "price": 299.00,
        "currency": "ZAR",
        "category": "Business",
        "stock": 12,
        "image": "",
    },
    {
        "id": "p3",
        "name": "Jibu Learning Pass",
        "description": "A demo pass for learning and skills development.",
        "price": 99.00,
        "currency": "ZAR",
        "category": "Education",
        "stock": 50,
        "image": "",
    },
]

ADS = [
    {
        "id": "a1",
        "title": "Grow Your Skills",
        "advertiser": "Jibu Learning",
        "description": "Discover new skills and practical learning.",
        "category": "Education",
        "cta": "Explore",
        "clicks": 320,
        "impressions": 8000,
        "conversions": 24,
        "destination": "",
    },
    {
        "id": "a2",
        "title": "Support Local Business",
        "advertiser": "Jibu Market",
        "description": "Find products and services from local sellers.",
        "category": "Commerce",
        "cta": "Discover",
        "clicks": 210,
        "impressions": 6000,
        "conversions": 18,
        "destination": "",
    },
    {
        "id": "a3",
        "title": "Build Better Habits",
        "advertiser": "Jibu Pesa",
        "description": "Explore simple savings and planning tools.",
        "category": "Finance",
        "cta": "Learn more",
        "clicks": 160,
        "impressions": 5000,
        "conversions": 12,
        "destination": "",
    },
]


MODULES = {
    "mentor": {
        "name": "Mentor",
        "category": "Education",
        "description": "Learning plans, explanations and study guidance.",
        "responses": [
            "Start with one achievable learning goal, then practise it daily.",
            "Break the topic into smaller lessons and review your progress weekly.",
        ],
    },
    "duka": {
        "name": "Duka",
        "category": "Retail POS",
        "description": "Retail operations, stock and point-of-sale guidance.",
        "responses": [
            "Review fast-moving stock and compare sales against restocking costs.",
            "Track daily sales, stock levels and margins to improve decisions.",
        ],
    },
    "tiba": {
        "name": "Tiba",
        "category": "Healthcare",
        "description": "General wellness information and healthcare navigation.",
        "responses": [
            "Keep a record of your symptoms and questions for a qualified clinician.",
            "For urgent or worsening symptoms, contact an appropriate healthcare professional.",
        ],
    },
    "soko": {
        "name": "Soko",
        "category": "Farming",
        "description": "Agricultural planning and market guidance.",
        "responses": [
            "Compare local market prices, input costs and expected harvest quantities.",
            "Check soil conditions, water availability and seasonal forecasts before planting.",
        ],
    },
    "sheria": {
        "name": "Sheria",
        "category": "Legal",
        "description": "General legal information and document preparation guidance.",
        "responses": [
            "Organise the relevant documents and write down the key dates and facts.",
            "Confirm important legal decisions with a qualified legal practitioner in your jurisdiction.",
        ],
    },
    "kazi": {
        "name": "Kazi",
        "category": "Gigs",
        "description": "Work opportunities, skills and gig planning.",
        "responses": [
            "Create a short skills profile and identify three suitable opportunities to pursue.",
            "Track applications, follow-ups and completed work in one simple log.",
        ],
    },
    "pesa": {
        "name": "Pesa",
        "category": "Savings",
        "description": "Budgeting, savings goals and financial education.",
        "responses": [
            "Set a realistic savings target and schedule a contribution you can sustain.",
            "Compare debt interest costs and essential expenses before choosing a savings amount.",
        ],
    },
    "mtaa": {
        "name": "Mtaa",
        "category": "Hyperlocal Alerts",
        "description": "Community notices and local information.",
        "responses": [
            "Check the time, location and source before acting on a local alert.",
            "Share community information only after checking its accuracy and relevance.",
        ],
    },
    "safiri": {
        "name": "Safiri",
        "category": "Ad Engine",
        "description": "Advertising insights, campaign metrics and discovery.",
        "responses": [
            "Compare click-through rate and conversion rate before changing a campaign.",
            "Test one creative change at a time and compare results over a meaningful sample.",
        ],
    },
}


# ------------------------------------------------------------------
# GLOBAL MODE AND CONFIGURATION
# ------------------------------------------------------------------

def demo_mode_enabled() -> bool:
    """Demo is the default. Explicitly disable it on the server for real mode."""
    value = os.getenv("JIBU_DEMO_MODE", "true").strip().lower()
    return value not in {"false", "0", "no", "off"}


def real_payments_enabled() -> bool:
    """Real transactions require an explicit server-side opt-in."""
    return (
        not demo_mode_enabled()
        and os.getenv("ENVIRONMENT", "demo").strip().lower()
        in {"production", "real"}
    )


def public_mode():
    return {
        "demo_mode": not real_payments_enabled(),
        "real_payments_enabled": real_payments_enabled(),
        "environment": (
            "real" if real_payments_enabled() else "demo"
        ),
    }


@app.get("/")
def root():
    return {
        "name": "Jibu API",
        "version": "1.0.0",
        "status": "ok",
        **public_mode(),
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/config")
def get_config():
    return {
        **public_mode(),
        "currency": "ZAR",
        "modules": list(MODULES.keys()),
        "payment_providers": [
            "payfast", "ozow", "stitch",
            "peach", "stripe", "paypal",
        ],
    }


# ------------------------------------------------------------------
# DASHBOARD, USERS, PRODUCTS AND ADS
# ------------------------------------------------------------------

@app.get("/stats")
def get_stats():
    impressions = sum(ad["impressions"] for ad in ADS)
    clicks = sum(ad["clicks"] for ad in ADS)
    conversions = sum(ad["conversions"] for ad in ADS)

    ctr = (clicks / impressions * 100) if impressions else 0
    conversion_rate = (
        conversions / clicks * 100 if clicks else 0
    )

    return {
        "impressions": impressions,
        "clicks": clicks,
        "conversions": conversions,
        "ctr": round(ctr, 2),
        "conversion_rate": round(conversion_rate, 2),
        "bounce_rate": 32.5,
        "active_users": len(USERS),
        "products": len(PRODUCTS),
        "ads": len(ADS),
        "mode": public_mode()["environment"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/users/{user_id}")
def get_user(user_id: str):
    for user in USERS:
        if user["id"] == user_id:
            return dict(user)
    raise HTTPException(status_code=404, detail="User not found")


@app.get("/products")
def get_products():
    return {"items": [dict(item) for item in PRODUCTS], "count": len(PRODUCTS)}


@app.get("/products/{product_id}")
def get_product(product_id: str):
    for product in PRODUCTS:
        if product["id"] == product_id:
            return dict(product)
    raise HTTPException(status_code=404, detail="Product not found")


@app.get("/ads")
def get_ads():
    items = []
    for ad in ADS:
        item = dict(ad)
        item["ctr"] = round(
            item["clicks"] / item["impressions"] * 100, 2
        ) if item["impressions"] else 0
        items.append(item)

    return {"items": items, "count": len(items)}


# ------------------------------------------------------------------
# NINE SIMULATED AI MODULES
# ------------------------------------------------------------------

class ModuleRequest(BaseModel):
    prompt: str = Field(
        default="Give me a helpful recommendation.",
        max_length=2000,
    )


@app.get("/modules")
def list_modules():
    return {
        "items": [
            {
                "id": module_id,
                "name": data["name"],
                "category": data["category"],
                "description": data["description"],
            }
            for module_id, data in MODULES.items()
        ]
    }


@app.post("/module/{module_name}")
def run_module(module_name: str, body: ModuleRequest):
    module_id = module_name.strip().lower()

    if module_id not in MODULES:
        raise HTTPException(
            status_code=404,
            detail="Unknown module. Use GET /modules to list available modules.",
        )

    module = MODULES[module_id]
    prompt = body.prompt.strip() or "Give me a helpful recommendation."

    # Stable, deterministic demo responses; no external AI API is called.
    response_index = sum(prompt.encode("utf-8")) % len(module["responses"])
    response = module["responses"][response_index]

    return {
        "module": module_id,
        "name": module["name"],
        "category": module["category"],
        "prompt": prompt,
        "response": response,
        "simulated": True,
        "disclaimer": (
            "This is a simulated prototype response, not professional advice."
        ),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ------------------------------------------------------------------
# UNIFIED CHECKOUT
# ------------------------------------------------------------------

Provider = Literal[
    "payfast", "ozow", "stitch", "peach", "stripe", "paypal"
]


class CheckoutRequest(BaseModel):
    provider: Provider = "stripe"
    product_id: str
    mode: Literal["demo", "real"] = "demo"
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


def safe_return_url(value: Optional[str], fallback: str) -> str:
    """Only allow HTTPS return URLs, or localhost during development."""
    if not value:
        return fallback

    from urllib.parse import urlparse

    parsed = urlparse(value)
    if parsed.scheme == "https" and parsed.netloc:
        return value
    if parsed.scheme == "http" and parsed.hostname in {
        "localhost", "127.0.0.1"
    }:
        return value

    raise HTTPException(
        status_code=400,
        detail="Return URLs must use HTTPS (localhost is allowed for development).",
    )


def demo_checkout(product: dict, provider: str):
    # This is a mock route. It never contacts a payment provider.
    token = secrets.token_urlsafe(8)
    return {
        "success": True,
        "mode": "demo",
        "charged": False,
        "provider": provider,
        "order_reference": f"DEMO-{token}",
        "product": product["name"],
        "amount": product["price"],
        "currency": product["currency"],
        "checkout_url": None,
        "message": (
            "Demo checkout successful. No payment was initiated "
            "and no money was charged."
        ),
    }


@app.post("/checkout")
def checkout(body: CheckoutRequest):
    product = next(
        (p for p in PRODUCTS if p["id"] == body.product_id),
        None,
    )
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    # Demo requests always bypass gateways, even when real payments
    # are enabled on the server.
    if body.mode == "demo":
        return demo_checkout(product, body.provider)

    # A client cannot enable real payments merely by changing its toggle.
    if not real_payments_enabled():
        raise HTTPException(
            status_code=403,
            detail=(
                "Real payments are disabled by server configuration. "
                "Configure JIBU_DEMO_MODE=false and ENVIRONMENT=production "
                "only after completing provider setup."
            ),
        )

    success_url = safe_return_url(
        body.success_url,
        "https://example.com/checkout/success",
    )
    cancel_url = safe_return_url(
        body.cancel_url,
        "https://example.com/checkout/cancel",
    )

    provider = body.provider

    if provider == "stripe":
        secret_key = os.getenv("STRIPE_SECRET_KEY", "").strip()
        if not secret_key:
            raise HTTPException(
                status_code=503,
                detail="Stripe is not configured on the server.",
            )

        stripe.api_key = secret_key

        try:
            session = stripe.checkout.Session.create(
                mode="payment",
                line_items=[
                    {
                        "price_data": {
                            "currency": product["currency"].lower(),
                            "product_data": {
                                "name": product["name"],
                                "description": product["description"],
                            },
                            "unit_amount": int(
                                round(product["price"] * 100)
                            ),
                        },
                        "quantity": 1,
                    }
                ],
                success_url=success_url,
                cancel_url=cancel_url,
                metadata={
                    "product_id": product["id"],
                    "app": "jibu",
                },
            )
            return {
                "success": True,
                "mode": "real",
                "charged": False,
                "provider": "stripe",
                "checkout_url": session.url,
                "session_id": session.id,
                "message": (
                    "Stripe Checkout created. Payment is not confirmed "
                    "until verified through a trusted server-side webhook."
                ),
            }
        except stripe.error.StripeError:
            logger.exception("Stripe checkout creation failed")
            raise HTTPException(
                status_code=502,
                detail="Unable to create Stripe Checkout Session.",
            )

    # These providers require their own signed requests, merchant
    # configuration, return verification and webhook implementation.
    provider_setup = {
        "payfast": ["PAYFAST_MERCHANT_ID", "PAYFAST_MERCHANT_KEY"],
        "ozow": ["OZOW_SITE_CODE", "OZOW_PRIVATE_KEY"],
        "stitch": ["STITCH_CLIENT_ID", "STITCH_CLIENT_SECRET"],
        "peach": ["PEACH_ENTITY_ID", "PEACH_ACCESS_TOKEN"],
        "paypal": ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"],
    }

    required = provider_setup.get(provider, [])
    missing = [
        key for key in required
        if not os.getenv(key, "").strip()
    ]

    if missing:
        raise HTTPException(
            status_code=503,
            detail=(
                f"{provider.title()} is not configured. Missing server "
                f"environment variables: {', '.join(missing)}"
            ),
        )

    # Credentials alone are not enough: do not invent a live checkout URL.
    raise HTTPException(
        status_code=501,
        detail=(
            f"{provider.title()} credentials are present, but its signed "
            "checkout adapter and verified callback flow must be implemented "
            "before live payments can be accepted."
        ),
    )


# Do not expose exception details or secret values in API responses.
@app.get("/debug/config")
def debug_config():
    # Safe diagnostic endpoint: values are never returned.
    keys = [
        "STRIPE_SECRET_KEY",
        "PAYFAST_MERCHANT_ID",
        "PAYFAST_MERCHANT_KEY",
        "OZOW_SITE_CODE",
        "OZOW_PRIVATE_KEY",
        "STITCH_CLIENT_ID",
        "STITCH_CLIENT_SECRET",
        "PEACH_ENTITY_ID",
        "PEACH_ACCESS_TOKEN",
        "PAYPAL_CLIENT_ID",
        "PAYPAL_CLIENT_SECRET",
    ]
    return {
        "real_payments_enabled": real_payments_enabled(),
        "configured": {
            key: bool(os.getenv(key, "").strip())
            for key in keys
        },
    }
