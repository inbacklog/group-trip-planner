import test from 'node:test';
import assert from 'node:assert/strict';
import {getCost,formatCost,parseSimplePrice,saveCostDraft,toCostDraft,parseFxRate,isOldRate} from '../src/lib/money.ts';
const c = {min:100,max:200,currency:'CNY',unit:'per_person'};
test('EUR: preserve original legacy range and explicit units; RMB normalizes',()=>{
 const d={legacy_record:{costMin:100,costMax:200,currency:'RMB',costUnit:'per_person',costStatus:'estimate'}};
 const original=JSON.stringify(d); assert.deepEqual(getCost(d,'USD'),c);
 assert.equal(formatCost(c),'100–200 CNY');assert.equal(formatCost(c,0.125,'EUR'),'12,5–25 €');
 assert.equal(JSON.stringify(d),original);
});
test('EUR: zero is free, missing/unknown is not; invalid ranges cannot be partially used',()=>{
 assert.equal(getCost({}),null);assert.equal(getCost({money:null,legacy_record:{costMin:100,costMax:200}},'CNY'),null);
 assert.equal(getCost({legacy_record:{costMin:0,costMax:0,costStatus:'unknown'}},'CNY'),null);
 assert.equal(formatCost(getCost({money:{...c,min:0,max:0}})), '0 CNY');
 for(const money of [{...c,min:-1},{...c,max:Infinity},{...c,min:300},{...c,max:'200'}]) assert.equal(getCost({money}),null);
});
test('EUR: conservative free text parsing does not invent fees from prose',()=>{
 assert.deepEqual(parseSimplePrice('100–200 RMB / person','EUR'),c);
 assert.equal(parseSimplePrice('Budget 100 RMB, premium 200 RMB','CNY'),null);
 assert.equal(parseSimplePrice('10 EUR + 20 EUR transfer','EUR'),null);
 assert.equal(parseSimplePrice('2027-05-10','EUR'),null);
 assert.equal(parseSimplePrice('EUR 5 USD','EUR'),null);
 assert.equal(parseSimplePrice('12 EUR / person · estimate','CNY').min,12);
 assert.equal(getCost({presentation:{estimated_cost:''},legacy_record:{costMin:100}},'CNY'),null);
});
test('EUR: editable structured amount validates decimals, bounds and unknown; edits take priority',()=>{
 const draft={min:'12,50',max:'',currency:'eur',unit:'per_group'};
 assert.deepEqual(saveCostDraft(draft),{min:12.5,max:12.5,currency:'EUR',unit:'per_group'});
 assert.equal(saveCostDraft({...draft,min:''}),null);
 for(const min of ['-10','NaN','Infinity','1e3','1.234','1000000000001']) assert.throws(()=>saveCostDraft({...draft,min}));
 assert.throws(()=>saveCostDraft({...draft,max:'10'}));assert.throws(()=>saveCostDraft({...draft,currency:''}));
 assert.deepEqual(toCostDraft({money:c},'USD'),{min:'100',max:'200',currency:'CNY',unit:'per_person'});
 assert.deepEqual(getCost({money:c,presentation:{estimated_cost:'50 EUR'}},'USD'),c);
});
test('EUR: validate provider base, quote, amount and actual observation date',()=>{
 const now=Date.UTC(2026,9,4);const valid={base:'CNY',quote:'EUR',rate:0.125,date:'2026-10-02'};
 const rate=parseFxRate(valid,'CNY',now);assert.equal(isOldRate(rate,now),false);assert.equal(isOldRate(rate,now+10*86400000),true);
 for(const item of [{...valid,base:'USD'},{...valid,quote:'USD'},{...valid,rate:0},{...valid,rate:'0.125'},{...valid,rate:Infinity},{...valid,date:'2026-02-30'},{...valid,date:'2027-01-01'}]) assert.throws(()=>parseFxRate(item,'CNY',now));
});
