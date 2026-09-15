#get PHONE_NUMBER_ID

# import requests

# ACCESS_TOKEN = "EAAWytxOTAecBQCx79epjNwizTC8SrvhAWlc2GrjTMX3lUdFzZANxSKVK9IZCd9i9i2NFfwmMmUYrOMr6ShWZCPK8OQNfOdO1XbQWWZCk8iyb3iZAmuUEZAxZCZCwCxRt7n1sUY3Rjdn62GFEOgtO7WMb6STVV5eagZCFceqiHYaLhmYvKIKq8mVk74TROGoHJUjoHOwZDZD"
# WABA_ID = "1404464654983824"  # ameen

# # WABA_ID = "1686345085673315" # koraiem

# url = f"https://graph.facebook.com/v19.0/{WABA_ID}/phone_numbers"

# headers = {
#     "Authorization": f"Bearer {ACCESS_TOKEN}"
# }

# response = requests.get(url, headers=headers)
# print(response.json())


#send message
import requests
import json

ACCESS_TOKEN = "EAAZACZC3NGZAOUBSQjHTK5u2kcruWf4flcZBj9EqE32rzVDbMr2T44b1ZAZAi9ZAtzYlUA5a9dxzjvzMpLRDoxhMSZCW1LvBNXLKWyhViZAD4flnElnClVUiqmidS5OXPgDVJR42ykvkTezlsqj2jmiptTuK5YOdrAQZCHUBqRZAUuBTBnPS6iaMZANPCqh20mtlnUifEQZDZD"
#PHONE_NUMBER_ID = "847987438407450" # ameen
PHONE_NUMBER_ID = "1267382513132793" # koraiem

TO_PHONE = "201122267427"  # رقم المستلم

# url = f"https://graph.facebook.com/v19.0/{PHONE_NUMBER_ID}/messages"

# headers = {
#     "Authorization": f"Bearer {ACCESS_TOKEN}",
#     "Content-Type": "application/json"
# }

# payload = {
#     "messaging_product": "whatsapp",
#     "to": TO_PHONE,
#     "type": "text",
#     "text": {
#         "body": "ولي امر الطالب/ة العزيز/ة، نود إعلامكم بأننا سنعقد اجتماعًا هامًا لمناقشة تقدم أبنائكم في الدراسة. حضوركم مهم جدًا لدعم نجاحهم الأكاديمي. شكرًا لتعاونكم."
#     }
# }

# response = requests.post(url, headers=headers, data=json.dumps(payload))

# print(response.status_code)
# print(response.json())


url = f"https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages"

headers = {
    "Authorization": f"Bearer {ACCESS_TOKEN}",
    "Content-Type": "application/json"
}

data = {
    "messaging_product": "whatsapp",
    "to": "201122267427",  # e.g., "201234567890"
    "type": "template",
    "template": {
        "name": "hii",  # Use your approved template name, variables if needed
        # variables example:
        "components": [
            {
                "type": "body",
                "parameters": 
                
                 [
                    {
                     "type": "text",
                     "text": "احمد قباري"
                     } ,
                #     {
                #         "type": "text",
                #         "text": "الاول"
                #     } ,{
                #         "type": "text",
                #         "text": "22"
                #     } ,{
                #         "type": "text",
                #         "text": "السبت"
                #     } 
                #     ,{
                #         "type": "text",
                #         "text": "⬅️الكود: 22669885⬅️الباسورد: 02569885"
                #     } ,{
                #         "type": "text",
                #         "text": "📱 لو معاك أندرويد:  https://play.google.com/store/apps/details?id=com.codiaeumtech.koraim_online_platform"
                #     } ,
                    
                #     {
                #         "type": "text",
                #         "text": "📱 لو معاك آيفون:  https://apps.apple.com/us/app/%D8%A8-%D8%A7%D9%84-%D8%B9-%D8%B1-%D8%A8-%D9%8A/id6737401826"},
                #     {
                #         "type": "text",
                #         "text": "https://wa.me/+201108352873"
                #     } ,
                ]
            
            
            }
        ] 

        
    ,
               
        

        "language": { "code": "en" }
    }
}

response = requests.post(url, headers=headers, data=json.dumps(data))

print(response.status_code)
print(response.text)
