import requests

RAILWAY_URL = "https://whatsappdashboard-production.up.railway.app"

def send_whatsapp_template(to: str, temp_name: str, data: list[str]):
    try:
        response = requests.post(
            f"{RAILWAY_URL}/send",
            json={
                "to": to,
                "tempName": temp_name,
                "phoneNumberId": "1243807105478673",
                "data": data
            },
            timeout=30
        )

        result = response.json()

        if not result.get("success", False):
            print(f"❌ Failed to send to {to}: {result.get('error', 'Unknown error')}")
        elif result.get("warning"):
            print(f"⚠️ Sent to {to} (id: {result['id']}) but warning: {result['warning']}")
        else:
            print(f"✅ Sent to {to} (id: {result['id']})")

        return result

    except requests.exceptions.RequestException as e:
        print(f"❌ Network error sending to {to}: {e}")
        return {"success": False, "error": str(e)}

def send_otp_whatsapp_template(to: str,  code: str):
    try:
        response = requests.post(
            f"{RAILWAY_URL}/send-otp",
            json={
                "to": to,
                "language": "ar",
                "phoneNumberId": "1243807105478673",
                "code": code
            },
            timeout=30
        )

        result = response.json()

        if not result.get("success", False):
            print(f"❌ Failed to send to {to}: {result.get('error', 'Unknown error')}")
        elif result.get("warning"):
            print(f"⚠️ Sent to {to} (id: {result['id']}) but warning: {result['warning']}")
        else:
            print(f"✅ Sent to {to} (id: {result['id']})")

        return result

    except requests.exceptions.RequestException as e:
        print(f"❌ Network error sending to {to}: {e}")
        return {"success": False, "error": str(e)}


# ── Bulk send with error tracking ───────────────────────────────────────────

def send_bulk(messages: list[dict]):
    """Send multiple messages and return a summary of successes/failures."""
    results = {"sent": [], "failed": []}

    for msg in messages:
        result = send_whatsapp_template(msg["to"], msg["temp_name"], msg["data"])
        if result.get("success"):
            results["sent"].append({"to": msg["to"], "id": result.get("id")})
        else:
            results["failed"].append({"to": msg["to"], "error": result.get("error")})

    print(f"\n📊 Summary: {len(results['sent'])} sent, {len(results['failed'])} failed")
    if results["failed"]:
        print("Failed numbers:")
        for f in results["failed"]:
            print(f"  • {f['to']}: {f['error']}")

    return results


# ── Examples ────────────────────────────────────────────────────────────────

# Single message
send_whatsapp_template(
    to="201008942259",
    data=["*هيام*","*الاحد (28/7)*","*من 04:00 الي 07:00 مساءً*","*سنتر فاروس*","01026168790","01068960965",],
    temp_name="std_warning"
    
)
# send_otp_whatsapp_template(
#     to="201008942259",
    
#     code="123456"
# )
# Bulk send example
# send_bulk([
#     {"to": "201114634917", "temp_name": "template_name", "data": ["param1", "param2"]},
#     {"to": "201012345678", "temp_name": "template_name", "data": ["param1", "param2"]},
# ])