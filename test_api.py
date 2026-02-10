import requests

url = "http://127.0.0.1:8000/api/upload/"
try:
    files = {'file': open('sample.csv', 'rb')}
    response = requests.post(url, files=files)
    print("Status Code:", response.status_code)
    print("Response:", response.json())
    files['file'].close()
except Exception as e:
    print("Error:", e)
