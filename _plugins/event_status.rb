# Derives each event's status (upcoming / current / past) from its dates, so an
# event moves from "à venir" to the homepage to "passés" without a commit.
#
# The date is taken in Belgian time. A UTC+1 offset is close enough: the
# scheduled rebuild in .github/workflows/deploy.yml runs at 23:30 UTC, which is
# already the next day in Belgium in both winter (00:30) and summer (01:30).
#
# `highlight_until:` hides the event's highlight box (e.g. the first day of an exhibition)
# once that date has passed, while the event itself stays current.
#
# An explicit `status:` in an event's front matter still wins, as an override.
# EVENTS_TODAY=YYYY-MM-DD fakes the date for local testing of the other states.
module Jekyll
  class EventStatus < Generator
    safe true
    priority :high

    def generate(site)
      events = site.collections['events']
      return unless events

      today = if ENV['EVENTS_TODAY']
                Date.parse(ENV['EVENTS_TODAY'])
              else
                (Time.now.utc + 3600).to_date
              end

      events.docs.each do |doc|
        until_date = to_date(doc.data['highlight_until'])
        doc.data['highlight_active'] = until_date.nil? || today <= until_date

        next if doc.data['status']

        start_date = to_date(doc.data['start_date'])
        end_date   = to_date(doc.data['end_date']) || start_date
        next unless start_date

        doc.data['status'] =
          if today < start_date then 'upcoming'
          elsif today > end_date then 'past'
          else 'current'
          end
      end
    end

    private

    def to_date(value)
      case value
      when Date then value
      when Time then value.to_date
      when String then Date.parse(value)
      end
    end
  end
end
