# Legge da App Store Connect lo stato dell'app, delle build e degli abbonamenti e lo scrive nel riepilogo di GitHub.
import os, time, json, urllib.request, jwt
KEY = open(os.environ['ASC_KEY_PATH']).read()
tok = jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': int(time.time()), 'exp': int(time.time()) + 900, 'aud': 'appstoreconnect-v1'},
                 KEY, algorithm='ES256', headers={'kid': os.environ['ASC_KEY_ID'], 'typ': 'JWT'})
def get(path):
    r = urllib.request.Request('https://api.appstoreconnect.apple.com' + path, headers={'Authorization': 'Bearer ' + tok})
    try:
        with urllib.request.urlopen(r) as f: return json.load(f)
    except urllib.error.HTTPError as e: return {'errore': e.code, 'dettaglio': e.read().decode()[:300]}
out = []
apps = get('/v1/apps?filter[bundleId]=com.tettostudio.spesecasa')
app = apps['data'][0]; aid = app['id']
out.append(f"## App: {app['attributes']['name']} (id {aid})")
for v in get(f'/v1/apps/{aid}/appStoreVersions?limit=5').get('data', []):
    out.append(f"- Versione {v['attributes']['versionString']} ({v['attributes']['platform']}): {v['attributes']['appStoreState']}")
out.append('## Build')
for b in get(f'/v1/builds?filter[app]={aid}&sort=-uploadedDate&limit=5').get('data', []):
    a = b['attributes']; out.append(f"- {a['version']}: {a['processingState']} (caricata {a['uploadedDate'][:16]}, scade {a['expirationDate'][:10]})")
out.append('## Abbonamenti')
for g in get(f'/v1/apps/{aid}/subscriptionGroups').get('data', []):
    out.append(f"### Gruppo: {g['attributes']['referenceName']} (id {g['id']})")
    gl = get(f"/v1/subscriptionGroups/{g['id']}/subscriptionGroupLocalizations").get('data', [])
    out.append('- Nome del gruppo nelle lingue: ' + (', '.join(f"{x['attributes']['locale']}={x['attributes']['name']} ({x['attributes'].get('state')})" for x in gl) or 'NESSUNO'))
    for s in get(f"/v1/subscriptionGroups/{g['id']}/subscriptions").get('data', []):
        a = s['attributes']; sid = s['id']
        out.append(f"#### {a['productId']}: stato {a['state']}, durata {a['subscriptionPeriod']}, livello {a.get('groupLevel')}")
        loc = get(f'/v1/subscriptions/{sid}/subscriptionLocalizations').get('data', [])
        out.append('- Nome/descrizione: ' + (', '.join(f"{x['attributes']['locale']}: {x['attributes']['name']} / {x['attributes'].get('description')}" for x in loc) or 'NESSUNO'))
        pr = get(f'/v1/subscriptions/{sid}/prices?filter[territory]=ITA&include=subscriptionPricePoint')
        pp = {i['id']: i['attributes'].get('customerPrice') for i in pr.get('included', [])}
        out.append('- Prezzo Italia: ' + (', '.join(str(pp.get(p['relationships']['subscriptionPricePoint']['data']['id'])) for p in pr.get('data', [])) or 'NESSUNO'))
        tot = get(f'/v1/subscriptions/{sid}/prices?limit=1').get('meta', {}).get('paging', {}).get('total')
        out.append(f'- Paesi con prezzo: {tot}')
        av = get(f'/v1/subscriptions/{sid}/subscriptionAvailability')
        if av.get('data'):
            t = get(f"/v1/subscriptionAvailabilities/{av['data']['id']}/availableTerritories?limit=200")
            out.append(f"- Disponibilità: {len(t.get('data', []))} paesi")
        else: out.append('- Disponibilità: NON CONFIGURATA ' + str(av.get('errore', '')))
        io = get(f'/v1/subscriptions/{sid}/introductoryOffers?limit=200').get('data', [])
        modi = sorted({(x['attributes']['offerMode'], x['attributes']['duration']) for x in io})
        out.append(f'- Offerta introduttiva: {len(io)} paesi, ' + (', '.join(f'{m} {d}' for m, d in modi) or 'NESSUNA'))
        rs = get(f'/v1/subscriptions/{sid}/appStoreReviewScreenshot')
        out.append('- Screenshot per la revisione: ' + ('sì' if rs.get('data') else 'manca'))
txt = '\n'.join(out); print(txt)

