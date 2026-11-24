# Applies the `temporary:` opening hours of _data/shop.yml on the days they are
# in force, and turns on the homepage notice (translations index.hours_notice)
# until they end. The nightly rebuild (.github/workflows/deploy.yml) makes both
# switch on their own, on the same Belgian date as the events (EventStatus.today;
# EVENTS_TODAY=YYYY-MM-DD fakes it for local testing).
#
# Sets site.data.shop.notice_active, and replaces closes/label of every day in
# site.data.shop.hours between `from` and `until` inclusive. The footer, the
# homepage hours and the Store JSON-LD all read those hours, so they follow.
module Jekyll
  class ShopHours < Generator
    safe true
    priority :high

    def generate(site)
      shop = site.data['shop']
      temp = shop && shop['temporary']
      return unless temp

      today = EventStatus.today
      from  = EventStatus.to_date(temp['from'])
      till  = EventStatus.to_date(temp['until'])

      shop['notice_active'] = today <= till
      return unless from <= today && today <= till

      shop['hours'] = shop['hours'].map do |h|
        h.merge('closes' => temp['closes'], 'label' => temp['label'])
      end
    end
  end
end
