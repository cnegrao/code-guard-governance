"""Independent specification oracle. Run manually to freeze, never from tests."""
import copy
import hashlib
import ipaddress
import json
import struct
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path


def frame(tag, payload=None):
    if payload is None:
        return b'\x00' + struct.pack('>Q', 0)
    return bytes([tag]) + struct.pack('>Q', len(payload)) + payload


def decimal(value):
    value = Decimal(value)
    if not value.is_finite():
        raise ValueError('nonfinite')
    if not value:
        return b'0'
    text = format(value, 'f')
    if '.' in text:
        text = text.rstrip('0').rstrip('.')
    return text.encode('ascii')


def integer(value):
    return frame(3, str(value).encode('ascii'))


def text(value):
    return frame(1, None if value is None else value.encode('utf8'))


def uid(value):
    return frame(2, None if value is None else uuid.UUID(value).bytes)


def timestamp(value):
    if value is None:
        return frame(4)
    instant = datetime.fromisoformat(value).astimezone(timezone.utc)
    delta = instant - datetime(1970, 1, 1, tzinfo=timezone.utc)
    micros = (delta.days * 86400 + delta.seconds) * 1000000 + delta.microseconds
    return frame(4, str(micros).encode('ascii'))


def ip(value):
    if value is None:
        return frame(11)
    address = ipaddress.ip_interface(value)
    return frame(11, bytes([address.version]) + address.ip.packed + bytes([address.network.prefixlen]))


def js(value):
    if value is None:
        return frame(0)
    if isinstance(value, bool):
        return frame(8 if value else 7, b'')
    if isinstance(value, (int, Decimal)):
        return frame(6, decimal(value))
    if isinstance(value, str):
        return text(value)
    if isinstance(value, list):
        return frame(10, integer(len(value)) + b''.join(js(v) for v in value))
    keys = sorted(value, key=lambda k: k.encode('utf8'))
    return frame(9, integer(len(keys)) + b''.join(text(k) + js(value[k]) for k in keys))


ORG = '11111111-1111-4111-8111-111111111111'
BASE = dict(organisation=ORG, chain='22222222-2222-4222-8222-222222222222',
            activation='33333333-3333-4333-8333-333333333333', sequence='1',
            entry='44444444-4444-4444-8444-444444444444', previous='ab' * 32,
            source_entry='55555555-5555-4555-8555-555555555555', event_type='CREATED',
            description='ordinary event', subject_type='SYSTEM',
            subject='66666666-6666-4666-8666-666666666666', actor='77777777-7777-4777-8777-777777777777',
            ip='192.0.2.9', session='88888888-8888-4888-8888-888888888888',
            event_at='2026-10-20T12:34:56.123456+00:00', recorded_at='2026-10-20T12:34:57.654321+00:00',
            payload='{"action":"create","ok":true}')


def genesis(a):
    return (text('GOVIA_LEDGER_TENANT_GENESIS_V2') + integer(2) + integer(1)
            + uid(a['organisation']) + uid(a['chain']) + uid(a['activation']) + timestamp(a['activated_at']))


def entry(a):
    return (text('GOVIA_LEDGER_TENANT_V2') + integer(2) + integer(1)
            + uid(a['organisation']) + uid(a['chain']) + uid(a['activation']) + integer(a['sequence'])
            + uid(a['entry']) + frame(5, bytes.fromhex(a['previous'])) + uid(a['source_entry'])
            + text(a['event_type']) + text(a['description']) + text(a['subject_type'])
            + uid(a['subject']) + uid(a['actor']) + ip(a['ip']) + uid(a['session'])
            + timestamp(a['event_at']) + timestamp(a['recorded_at'])
            + js(json.loads(a['payload'], parse_float=Decimal, parse_int=int)))


vectors = []


def add(name, kind, args, data):
    vectors.append(dict(name=name, kind=kind, args=args, hex=data.hex(), sha256=hashlib.sha256(data).hexdigest()))


g = dict(organisation=ORG, chain=BASE['chain'], activation=BASE['activation'], activated_at=BASE['event_at'])
add('genesis', 'genesis', g, genesis(g))
gb = dict(g, organisation='99999999-9999-4999-8999-999999999999')
add('genesis-other-organisation', 'genesis', gb, genesis(gb))
for name, changes in [
    ('ordinary-event', {}), ('null-nullable-fields', dict(actor=None, ip=None, session=None)),
    ('empty-description', dict(description='')), ('empty-object', dict(payload='{}')),
    ('nested-object', dict(payload='{"z":[null,true,false,{"x":-12.3400}],"a":{"k":"v"}}')),
    ('key-order-a', dict(payload='{"z":2,"a":1,"é":3,"A":4}')),
    ('key-order-b', dict(payload='{"A":4,"é":3,"a":1,"z":2}')),
    ('array-order-a', dict(payload='[1,2,3]')), ('array-order-b', dict(payload='[3,2,1]')),
    ('unicode', dict(description='Governança 日本 😀 e\u0301 é', payload='{"😀":"ação","é":"日本"}')),
    ('large-integer', dict(payload='{"n":1234567890123456789012345678901234567890}')),
    ('negative-integer', dict(payload='-9223372036854775808')),
    ('fractional-decimal', dict(payload='1234567890.1234567890123456789000')),
    ('exponent', dict(payload='1.234500e-12')), ('exponent-expanded', dict(payload='0.0000000000012345')),
    ('negative-zero', dict(payload='-0.000e5')), ('zero', dict(payload='0')),
    ('microsecond', dict(recorded_at='2026-10-20T12:34:57.654322+00:00')),
    ('timezone-equivalent', dict(recorded_at='2026-10-20T09:34:57.654321-03:00')),
    ('ipv4-prefix', dict(ip='192.0.2.9/24')), ('ipv6', dict(ip='2001:db8::cafe/64')),
    ('ipv6-equivalent', dict(ip='2001:0db8:0000:0000:0000:0000:0000:cafe/64')),
    ('other-organisation', dict(organisation='99999999-9999-4999-8999-999999999999')),
    ('other-predecessor', dict(previous='cd'*32)),
    ('other-chain', dict(chain='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),
    ('other-activation', dict(activation='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),
    ('source-identity', dict(source_entry='cccccccc-cccc-4ccc-8ccc-cccccccccccc')),
    ('large-sequence', dict(sequence='9223372036854775807')),
    ('json-null', dict(payload='null')), ('empty-array', dict(payload='[]')),
]:
    a = copy.deepcopy(BASE)
    a.update(changes)
    add(name, 'entry', a, entry(a))
for name, value in [('text-null', None), ('text-empty', ''), ('text-unicode', 'á😀')]:
    add(name, 'text', value, text(value))
for value in ['0.0012000', '-0', '1e30', '-1.20', 'NaN']:
    if value == 'NaN':
        continue
    add('decimal-' + value, 'decimal', value, frame(6, decimal(value)))
for value in ['1969-12-31T23:59:59.999999+00:00', '1970-01-01T00:00:00+00:00']:
    add('timestamp-' + value, 'timestamp', value, timestamp(value))
target = Path(__file__).resolve().parent.parent / 'fixtures' / 'ledger-v2-serialization-v1.json'
target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps(dict(version=1, vectors=vectors), ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(f'{len(vectors)} golden vectors frozen at {target}')
