import aiohttp
import asyncio

async def send_message(config, phone, body):
    url = f"https://graph.facebook.com/v21.0/1057331837443942/messages"
    
    headers = {
        'Authorization': f"Bearer EAAWytxOTAecBQCx79epjNwizTC8SrvhAWlc2GrjTMX3lUdFzZANxSKVK9IZCd9i9i2NFfwmMmUYrOMr6ShWZCPK8OQNfOdO1XbQWWZCk8iyb3iZAmuUEZAxZCZCwCxRt7n1sUY3Rjdn62GFEOgtO7WMb6STVV5eagZCFceqiHYaLhmYvKIKq8mVk74TROGoHJUjoHOwZDZD",
        'Content-Type': 'application/json'
    }
    
    data = {
        "messaging_product": "whatsapp",
        "to": "201122267427",
        "type": "text",
        "text": { "body": "test" }
    }
    
    async with aiohttp.ClientSession() as session:
        async with session.post(url, headers=headers, json=data) as res:
            response_data = await res.json()
            return response_data

asyncio.run(send_message(None, None, None))