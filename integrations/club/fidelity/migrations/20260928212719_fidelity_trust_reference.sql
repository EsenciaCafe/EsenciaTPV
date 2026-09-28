insert into club_bridge_private.sources(id,enabled) values('tbqvypdxcgeofsmiqmuo',false);
insert into club_bridge_private.employees(source,employee_id,actor,enabled,permissions)
select 'tbqvypdxcgeofsmiqmuo',v.staff_id,c.auth_user_id,true,
array['member.lookup','member.offers','award.purchase','award.clear','assignment.get','redemption.reserve','redemption.commit','redemption.release']::text[] ||
case when v.staff_id='admin-default' then array['award.courtesy','assignment.withdraw','reward.catalogue','operation.get']::text[] else '{}'::text[] end
from (values('admin-default'),('staff-1782079793911'),('staff-1782141344525'),('staff-1782157516054')) v(staff_id)
cross join public.customers c where c.name='Joel Benitez' and c.auth_user_id is not null and c.role='admin';
insert into club_bridge_private.rules(reward_id,source,rule) select reward_id,'tbqvypdxcgeofsmiqmuo',rule from club_private.reward_benefits;
insert into club_bridge_private.trusted_keys(kid,public_key,issuer,source,enabled) values('tpv-v1','-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAHeGQKog0rPg3v1HQAxTPhpl1U1DhJfVyEnZyFC+ZLpo=
-----END PUBLIC KEY-----
','esencia-tpv','tbqvypdxcgeofsmiqmuo',true);
update club_bridge_private.sources set enabled=true where id='tbqvypdxcgeofsmiqmuo';
