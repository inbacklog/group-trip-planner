import {test,expect} from '@playwright/test';
import {installFixture,GROUP_ID,TRIP_ID,USER_ID,trip} from './fixture';
const A='44444444-4444-4444-8444-000000000001',B='44444444-4444-4444-8444-000000000002';
const url=`/?group=${GROUP_ID}&trip=${TRIP_ID}`;
function seed(state:Awaited<ReturnType<typeof installFixture>>) {
 state.trips=[{...trip,currency:'CNY'}];
 state.stops=[{id:A,trip_id:TRIP_ID,name:'Σαγκάη',position:0,version:1},{id:B,trip_id:TRIP_ID,name:'Πεκίνο',position:1,version:1}];
 state.activities=[
  {id:'55555555-5555-4555-8555-000000000001',trip_id:TRIP_ID,title:'Συνθετικό μουσείο',description:'Μια ιδέα',why_visit:'',stop_id:A,created_by:USER_ID,version:1,details:{legacy_record:{costMin:100,costMax:200,costUnit:'per_person'},presentation:{kind:'activity'}}},
  {id:'55555555-5555-4555-8555-000000000002',trip_id:TRIP_ID,title:'Συνθετικό πάρκο',description:'Μια βόλτα',why_visit:'',stop_id:B,created_by:USER_ID,version:1,details:{money:{min:0,max:0,currency:'CNY',unit:'per_person'},presentation:{kind:'place'}}},
  {id:'55555555-5555-4555-8555-000000000003',trip_id:TRIP_ID,title:'Νέα ιδέα χωρίς τιμή',description:'Κόστος άγνωστο',why_visit:'',stop_id:null,created_by:USER_ID,version:1,details:{}},
 ];
}
test('account name persists, populates members, and an empty group alias restores global name',async({page})=>{
 const state=await installFixture(page,{signedIn:true,withGroup:true});
 await page.goto(`/?group=${GROUP_ID}`);
 await page.getByRole('button',{name:'Ρυθμίσεις λογαριασμού',exact:true}).click();
 await page.getByLabel('Εμφανιζόμενο όνομα',{exact:true}).fill('Test Explorer');
 await page.getByRole('button',{name:'Αποθήκευση λογαριασμού',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.profile).toEqual({display_name:'Test Explorer',version:1});
 await page.getByRole('button',{name:/^Μέλη/}).click();
 await expect(page.locator('.member-row strong')).toHaveText('Test Explorer');
 await page.getByLabel('Το όνομά σου στην παρέα',{exact:true}).fill('Local alias');
 await page.getByRole('button',{name:'Αποθήκευση ονόματος',exact:true}).click();
 await expect(page.locator('.member-row strong')).toHaveText('Local alias');
 await page.getByLabel('Το όνομά σου στην παρέα',{exact:true}).fill('');
 await page.getByRole('button',{name:'Αποθήκευση ονόματος',exact:true}).click();
 await expect(page.locator('.member-row strong')).toHaveText('Test Explorer');
 await page.reload();
 await page.getByRole('button',{name:'Ρυθμίσεις λογαριασμού',exact:true}).click();
 await expect(page.getByLabel('Εμφανιζόμενο όνομα',{exact:true})).toHaveValue('Test Explorer');
});
test('owner renames group without changing its ID or trip; member has no rename control',async({page})=>{
 const state=await installFixture(page,{signedIn:true,withGroup:true,withTrip:true});
 await page.goto(`/?group=${GROUP_ID}`);
 await page.getByRole('button',{name:'Μετονομασία παρέας',exact:true}).click();
 await page.getByLabel('Όνομα παρέας',{exact:true}).fill('Νέα ονομασία');
 await page.getByRole('button',{name:'Αποθήκευση ονόματος παρέας',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Νέα ονομασία',exact:true})).toBeVisible();
 expect(state.groups[0].id).toBe(GROUP_ID);expect(state.trips[0].id).toBe(TRIP_ID);
 expect(state.mutations.find(m=>m.path.endsWith('/rpc/rename_group'))?.body).toEqual({p_group_id:GROUP_ID,p_name:'Νέα ονομασία',p_expected_version:1});
});
test('ordinary member cannot see group rename but can open their own profile',async({page})=>{
 await installFixture(page,{signedIn:true,withGroup:true,memberRole:'member'});
 await page.goto(`/?group=${GROUP_ID}`);
 await expect(page.getByRole('button',{name:'Μετονομασία παρέας',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Ρυθμίσεις λογαριασμού',exact:true}).click();
 await expect(page.getByLabel('Εμφανιζόμενο όνομα',{exact:true})).toBeVisible();
});
test('route click filters ideas, toggles off, keeps keyboard support, and preselects a new idea stop',async({page},testInfo)=>{
 const state=await installFixture(page,{signedIn:true,withGroup:true,withTrip:true});seed(state);
 await page.goto(url);await expect(page.locator('.idea-card')).toHaveCount(3);
 await page.getByRole('button',{name:'Ιδέες για Σαγκάη',exact:true}).click();
 await expect(page.getByLabel('Φίλτρο στάσης')).toHaveValue(A);
 await expect(page.locator('.idea-card')).toHaveCount(1);
 await expect(page.locator('.idea-card h3')).toHaveText('Συνθετικό μουσείο');
 await expect(page.getByRole('button',{name:'Ιδέες για Σαγκάη',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.money-euro').first()).toHaveText('≈ 12,5–25 €');
 await page.screenshot({path:testInfo.outputPath('route-euro.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'Νέα πρόταση',exact:true}).click();
 await expect(page.getByRole('dialog').getByLabel('Στάση',{exact:true})).toHaveValue(A);
 await page.getByRole('button',{name:'Ακύρωση',exact:true}).click();
 const route=page.getByRole('button',{name:'Ιδέες για Σαγκάη',exact:true});await route.focus();await page.keyboard.press('Enter');
 await expect(page.locator('.idea-card')).toHaveCount(3);
 await page.getByLabel('Αναζήτηση καταχωρίσεων').fill('παρκο');
 await expect(page.locator('.idea-card')).toHaveCount(1);
 await page.getByRole('button',{name:'Καθαρισμός φίλτρων'}).click();
 await page.getByLabel('Φίλτρο στάσης').selectOption('__unassigned__');
 await expect(page.locator('.idea-card h3')).toHaveText('Νέα ιδέα χωρίς τιμή');
});
test('EUR source data is unchanged, unknown never becomes free; refresh handles unavailable service',async({page})=>{
 const state=await installFixture(page,{signedIn:true,withGroup:true,withTrip:true});seed(state);const original=JSON.stringify(state.activities);
 await page.goto(url);await expect(page.locator('.idea-card').filter({hasText:'Νέα ιδέα χωρίς τιμή'}).locator('.money-unknown')).toBeVisible();
 const museum=page.locator('.idea-card').filter({hasText:'Συνθετικό μουσείο'});await expect(museum.locator('.money-euro')).toHaveText('≈ 12,5–25 €');
 await museum.locator('.idea-main').click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('link',{name:'ΕΚΤ μέσω Frankfurter',exact:true})).toBeVisible();
 await expect(dialog.locator('.money-values')).toContainText('100–200 CNY');
 await page.route('https://api.frankfurter.dev/**',route=>route.fulfill({status:503,body:'Unavailable'}));
 await dialog.getByRole('button',{name:'Ανανέωση ισοτιμίας',exact:true}).click();
 await expect(dialog.getByText('Δεν έγινε ανανέωση· χρησιμοποιείται η αποθηκευμένη ισοτιμία.',{exact:true})).toBeVisible();
 expect(JSON.stringify(state.activities)).toBe(original);
});
test('EUR failure without cache does not insert a fabricated exchange rate',async({page})=>{
 const state=await installFixture(page,{signedIn:true,withGroup:true,withTrip:true});seed(state);
 await page.route('https://api.frankfurter.dev/**',route=>route.fulfill({status:503,body:'Unavailable'}));
 await page.goto(url);await expect(page.locator('.idea-card').filter({hasText:'Συνθετικό μουσείο'}).locator('.money-euro')).toHaveText('€ μη διαθέσιμο');
 await expect(page.locator('.idea-card').filter({hasText:'Συνθετικό μουσείο'}).locator('.money-original')).toContainText('100–200 CNY');
});
