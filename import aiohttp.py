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
    to="20122267427",
    temp_name="koraiem_attendace_absent_template",
    data=["أحمد قباري","الاول","22","السبت","⬅️الكود: 22669885⬅️الباسورد: 02569885"]
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