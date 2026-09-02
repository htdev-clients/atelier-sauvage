require 'csv'
require 'json'

module Jekyll
  # Reads _database/catalog.csv into site.data['catalog'], emits one product
  # page per item (in every language -- polyglot re-runs generators per
  # language pass) and, on the default-language pass only, /catalogue.json:
  # the build data the Pages Functions read prices and sellability from.
  #
  # Sellability is NOT derived here. scripts/validate.py decides it when the
  # catalogue is synced from the Sheet and records it in
  # _database/catalog_validation.json; this plugin only reads that sidecar, so
  # the site, the ledger and Stripe cannot disagree about what is for sale.
  class CatalogGenerator < Generator
    safe true
    priority :highest

    BANDS = %w[S M L XL].freeze

    def generate(site)
      csv_path = File.join(site.source, '_database', 'catalog.csv')
      sidecar_path = File.join(site.source, '_database', 'catalog_validation.json')
      img_dir = File.join(site.source, 'assets', 'img', 'catalog', '1400')

      unless File.exist?(csv_path)
        puts "⚠️ [CatalogGenerator] Could not find file: #{csv_path}"
        return
      end

      begin
        sellable = read_sellable(sidecar_path)
        extra_indices = scan_extra_images(img_dir)
        csv_text = File.read(csv_path, encoding: 'bom|utf-8')

        rows = CSV.parse(csv_text, headers: true, col_sep: ';', liberal_parsing: true).map do |row|
          row_hash = row.to_hash

          # 'pending' rows are not published at all.
          current_status = row_hash['statut'].to_s.downcase.strip
          next nil if current_status == 'pending'

          row_hash['number'] = row_hash['number'].to_s.strip
          number = row_hash['number']
          row_hash['category'] = row_hash['category'].to_s.strip
          row_hash['statut'] = row_hash['statut'].to_s.strip

          # Extra images are whatever is actually on disk; gaps are tolerated.
          indices = extra_indices.fetch(number, [])
          row_hash['images'] = 1 + indices.length
          row_hash['image_indices'] = indices

          # Shop fields. The Sheet columns may not exist yet; everything
          # degrades to "not buyable" rather than failing the build.
          band = row_hash['transport'].to_s.strip.upcase
          row_hash['transport'] = band
          row_hash['sold'] = current_status == 'vendu'
          row_hash['sellable'] = sellable.include?(number)
          row_hash['price_cents'] = price_cents(row_hash['prix'])
          row_hash['buyable'] = row_hash['sellable'] && !row_hash['sold'] &&
                                BANDS.include?(band) && !row_hash['price_cents'].nil?
          row_hash
        end.compact

        site.data['catalog'] = rows

        rows.each { |item| site.pages << ProductPage.new(site, item) }

        # Build data for the Functions: once, on the default-language pass.
        if site.active_lang.to_s.empty? || site.active_lang == site.default_lang
          site.pages << CatalogDataPage.new(site, rows)
        end
      rescue => e
        puts "❌ [CatalogGenerator] Error: #{e.message}"
        raise
      end
    end

    private

    def read_sellable(path)
      unless File.exist?(path)
        puts "⚠️ [CatalogGenerator] No #{File.basename(path)} -- nothing is sellable"
        return []
      end
      Array(JSON.parse(File.read(path, encoding: 'utf-8'))['sellable']).map(&:to_s)
    end

    # Groups '{number}-{index}-1400.webp' by number. Base images have no index
    # segment and are correctly excluded.
    def scan_extra_images(img_dir)
      extra = {}
      return extra unless Dir.exist?(img_dir)
      Dir.children(img_dir).each do |fname|
        m = fname.match(/\A(.+)-(\d+)-1400\.webp\z/)
        next unless m
        (extra[m[1]] ||= []) << m[2].to_i
      end
      extra.each_value(&:sort!)
      extra
    end

    # validate.py already normalised prices to a plain run of digits (whole
    # euros). Anything else is not a price we are willing to charge.
    def price_cents(prix)
      text = prix.to_s.strip
      return nil unless text.match?(/\A\d+\z/)
      value = text.to_i
      value.positive? ? value * 100 : nil
    end
  end

  # A generator-created page. No source file on disk, so data is set directly
  # instead of calling read_yaml.
  class ProductPage < Jekyll::Page
    def initialize(site, item)
      @site = site
      @base = site.source
      @dir  = File.join('catalogue', item['number'].to_s)
      @name = 'index.html'
      process(@name)
      self.content = ''
      self.data = {
        'layout'   => 'product',
        'i18n_key' => 'product',
        'item'     => item,
        'title'    => item['description']
      }
    end
  end

  # /catalogue.json -- what functions/api/* read through the ASSETS binding.
  # Only the fields the shop needs; descriptions are included because the
  # Stripe line item and the emails name the item.
  class CatalogDataPage < Jekyll::Page
    def initialize(site, rows)
      @site = site
      @base = site.source
      @dir  = ''
      @name = 'catalogue.json'
      process(@name)
      items = {}
      rows.each do |r|
        items[r['number']] = {
          'description' => r['description'].to_s,
          'category'    => r['category'].to_s,
          'price_cents' => r['price_cents'],
          'transport'   => r['transport'].to_s,
          'poids'       => r['poids'].to_s.strip,
          'sold'        => r['sold'],
          'sellable'    => r['sellable'],
          'buyable'     => r['buyable']
        }
      end
      self.content = JSON.generate({
        'generated' => site.time.utc.iso8601,
        'items'     => items
      })
      self.data = { 'layout' => nil, 'sitemap' => false }
    end
  end
end
