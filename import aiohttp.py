import requests

RAILWAY_URL = "https://whatsappdashboard-production.up.railway.app"

def send_whatsapp_template(to: str, temp_name: str, data: list[str]):
    try:
        response = requests.post(
            f"{RAILWAY_URL}/send",
            json={
                "to": to,
                "tempName": temp_name,
                "language": "ar",
                "phoneNumberId": "1057331837443942",
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
    to="201122267427",
    
    temp_name="otp_temp",
    data=["123456"]
)

# Bulk send example
# send_bulk([
#     {"to": "201114634917", "temp_name": "template_name", "data": ["param1", "param2"]},
#     {"to": "201012345678", "temp_name": "template_name", "data": ["param1", "param2"]},
# ])