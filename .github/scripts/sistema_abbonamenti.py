# Completa gli abbonamenti su App Store Connect: disponibilità in tutti i paesi,
# prova gratuita di 1 settimana su entrambi, nome del gruppo in italiano. Si può rilanciare: salta ciò che c'è già.
import os, time, json, urllib.request, jwt
KEY = open(os.environ['ASC_KEY_PATH']).read()
tok = jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': int(time.time()), 'exp': int(time.time()) + 1200, 'aud': 'appstoreconnect-v1'},
                 KEY, algorithm='ES256', headers={'kid': os.environ['ASC_KEY_ID'], 'typ': 'JWT'})
def call(method, path, body=None):
    url = path if path.startswith('http') else 'https://api.appstoreconnect.apple.com' + path
    r = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None,
                               headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(r) as f: return f.status, (json.load(f) if f.length != 0 else {})
    except urllib.error.HTTPError as e: return e.code, {'testo': e.read().decode()[:400]}
def tutti(path):
    out = []
    while path:
        s, j = call('GET', path); out += j.get('data', []); path = (j.get('links') or {}).get('next')
    return out
log = []
aid = tutti('/v1/apps?filter[bundleId]=com.tettostudio.spesecasa')[0]['id']
terr = [t['id'] for t in tutti('/v1/territories?limit=200')]
log.append(f'Paesi App Store: {len(terr)}')
for g in tutti(f'/v1/apps/{aid}/subscriptionGroups'):
    if not tutti(f"/v1/subscriptionGroups/{g['id']}/subscriptionGroupLocalizations"):
        s, j = call('POST', '/v1/subscriptionGroupLocalizations', {'data': {'type': 'subscriptionGroupLocalizations',
            'attributes': {'name': 'Spese Casa Premium', 'locale': 'it'},
            'relationships': {'subscriptionGroup': {'data': {'type': 'subscriptionGroups', 'id': g['id']}}}}})
        log.append(f'Nome del gruppo: {s} {j.get("testo", "ok")}')
    else: log.append('Nome del gruppo: già presente')
    for sub in tutti(f"/v1/subscriptionGroups/{g['id']}/subscriptions"):
        sid, pid = sub['id'], sub['attributes']['productId']
        s, j = call('GET', f'/v1/subscriptions/{sid}/subscriptionAvailability')
        if s == 200 and j.get('data'):
            n = len(tutti(f"/v1/subscriptionAvailabilities/{j['data']['id']}/availableTerritories?limit=200"))
            log.append(f'{pid} disponibilità: già presente ({n} paesi)')
        else:
            s, j = call('POST', '/v1/subscriptionAvailabilities', {'data': {'type': 'subscriptionAvailabilities',
                'attributes': {'availableInNewTerritories': True},
                'relationships': {'subscription': {'data': {'type': 'subscriptions', 'id': sid}},
                                  'availableTerritories': {'data': [{'type': 'territories', 'id': t} for t in terr]}}}})
            log.append(f'{pid} disponibilità: {s} {j.get("testo", "ok")}')
        gia = {x['relationships']['territory']['data']['id'] for x in tutti(f'/v1/subscriptions/{sid}/introductoryOffers?limit=200&include=territory') if x.get('relationships', {}).get('territory', {}).get('data')}
        mancano = [t for t in terr if t not in gia]; ok = err = 0; primo = ''
        for t in mancano:
            s, j = call('POST', '/v1/subscriptionIntroductoryOffers', {'data': {'type': 'subscriptionIntroductoryOffers',
                'attributes': {'duration': 'ONE_WEEK', 'offerMode': 'FREE_TRIAL', 'numberOfPeriods': 1},
                'relationships': {'subscription': {'data': {'type': 'subscriptions', 'id': sid}},
                                  'territory': {'data': {'type': 'territories', 'id': t}}}}})
            if s in (200, 201): ok += 1
            else:
                err += 1; primo = primo or f'{t}: {s} {j.get("testo", "")}'
        log.append(f'{pid} prova 1 settimana: già {len(gia)} paesi, aggiunti {ok}, errori {err} {primo}')
print('\n'.join(log))
