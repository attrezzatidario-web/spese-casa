# Scrive le "Novità di questa versione" nelle 5 lingue sulla versione in preparazione.
import os, time, json, urllib.request, jwt
KEY = open(os.environ['ASC_KEY_PATH']).read()
tok = jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': int(time.time()), 'exp': int(time.time()) + 900, 'aud': 'appstoreconnect-v1'}, KEY, algorithm='ES256', headers={'kid': os.environ['ASC_KEY_ID'], 'typ': 'JWT'})
def call(m, p, b=None):
    r = urllib.request.Request('https://api.appstoreconnect.apple.com' + p, method=m, data=json.dumps(b).encode() if b else None, headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(r) as f: t = f.read(); return f.status, (json.loads(t) if t else {})
    except urllib.error.HTTPError as e: return e.code, {'testo': e.read().decode()[:400]}
T = {'it': 'Lettura degli scontrini con l\'IA più affidabile e piccoli miglioramenti di stabilità.',
     'en-US': 'More reliable AI receipt scanning and small stability improvements.',
     'es-ES': 'Lectura de tickets con IA más fiable y pequeñas mejoras de estabilidad.',
     'fr-FR': 'Lecture des tickets par IA plus fiable et petites améliorations de stabilité.',
     'de-DE': 'Zuverlässigeres Erfassen von Belegen mit KI und kleine Stabilitätsverbesserungen.'}
aid = call('GET', '/v1/apps?filter[bundleId]=com.tettostudio.spesecasa')[1]['data'][0]['id']
v = [x for x in call('GET', f'/v1/apps/{aid}/appStoreVersions?filter[platform]=IOS')[1]['data'] if x['attributes']['appStoreState'] == 'PREPARE_FOR_SUBMISSION'][0]
print('Versione', v['attributes']['versionString'])
for l in call('GET', f"/v1/appStoreVersions/{v['id']}/appStoreVersionLocalizations")[1]['data']:
    loc = l['attributes']['locale']
    if loc in T:
        s, j = call('PATCH', f"/v1/appStoreVersionLocalizations/{l['id']}", {'data': {'type': 'appStoreVersionLocalizations', 'id': l['id'], 'attributes': {'whatsNew': T[loc]}}})
        print(loc, s, j.get('testo', 'ok'))
