import requests

RAILWAY_URL = "https://whatsappdashboard-production.up.railway.app"

def send_whatsapp_template(to: str, temp_name: str, data: list[str]):
    response = requests.post(
        f"{RAILWAY_URL}/send",
        json={
            "to": to,
            "tempName": temp_name,
            "data": data
        }
    )
    
    result = response.json()
    
    if response.ok:
        print(f"✅ Sent to {to} | ID: {result.get('id')}")
    else:
        print(f"❌ Failed to {to} | Error: {result.get('error')}")
    
    return result


# ── Examples ────────────────────────────────────────────────────────────────

# Single message
send_whatsapp_template(
    to="201114634917",
    temp_name="koraiem_arabic_std_code_template",
    data=["أحمد قباري","الاول","22","السبت","⬅️الكود: 22669885⬅️الباسورد: 02569885","📱 لو معاك أندرويد: https://play.google.com/store/apps/details?id=com.codenredstech.koraiem_platform","📱 لو معاك آيفون: https://apps.apple.com/us/app/%D8%A8-%D8%A7%D9%84-%D8%B9-%D8%B1-%D8%A8-%D9%8A/id6737401826","https://wa.me/+201108352873",]
)

# # Bulk messages
# students = [
#     {"phone": "201111111111", "name": "Ahmed"},
#     {"phone": "201222222222", "name": "Mohamed"},
#     {"phone": "201333333333", "name": "Sara"},
# ]

# for student in students:
    # send_whatsapp_template(
    #     to=student["phone"],
    #     temp_name="student_arrival",
    #     data=[student["name"]]
    # )