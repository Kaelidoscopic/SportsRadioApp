// Uses public certificates from an explicitly selected local instance; no network needed.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {load,validateTls}=require('./start.cjs');
const {state,c}=load(process.env.SPORTSRADIO_LOCAL_CONFIG);
const cert=fs.readFileSync(path.join(state,'server-cert.pem')),ca=fs.readFileSync(path.join(state,'public-ca/root-ca.pem'));
test('rotated certificate has matching CA and exact IP SAN',()=>assert.doesNotThrow(()=>validateTls(cert,ca,c)));
test('expired and not-yet-valid certificates fail closed',()=>{
 const {X509Certificate}=require('node:crypto'),x=new X509Certificate(cert);
 assert.throws(()=>validateTls(cert,ca,c,Date.parse(x.validTo)),/expired/);
 assert.throws(()=>validateTls(cert,ca,c,Date.parse(x.validFrom)-1),/not yet valid/);
});
test('wrong CA fingerprint and IP identity fail closed',()=>{
 assert.throws(()=>validateTls(cert,ca,{...c,caSha256:'0'.repeat(64)}),/mismatch/);
 assert.throws(()=>validateTls(cert,ca,{...c,lanAddress:'10.0.0.140'}),/mismatch/);
});
