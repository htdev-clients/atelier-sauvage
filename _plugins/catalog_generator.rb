module Jekyll
  class CatalogGenerator < Generator
    safe true
    priority :highest

    def generate(site)
      require 'csv'

      csv_path = File.join(site.source, '_database', 'catalog.csv')
      # Path to your images (Source of Truth)
      img_dir = File.join(site.source, 'assets', 'img', 'catalog', '1400')

      if File.exist?(csv_path)
        csv_text = File.read(csv_path, encoding: 'bom|utf-8')

        begin
          # Scan the image dir once and group each item's extra-image indices.
          # Matches '{number}-{index}-1400.webp'; base images ('{number}-1400.webp')
          # have no index segment and are correctly excluded.
          extra_indices = {}
          if Dir.exist?(img_dir)
            Dir.children(img_dir).each do |fname|
              m = fname.match(/\A(.+)-(\d+)-1400\.webp\z/)
              next unless m
              (extra_indices[m[1]] ||= []) << m[2].to_i
            end
            extra_indices.each_value(&:sort!)
          end

          rows = CSV.parse(csv_text,
            headers: true,
            col_sep: ';',
            liberal_parsing: true
          ).map do |row|
            row_hash = row.to_hash

            # Check the 'statut' column. If it is 'pending', we skip this item entirely.
            current_status = row_hash['statut'].to_s.downcase.strip
            if current_status == 'pending'
              next nil # Returns nil for this iteration
            end
            # ---------------------------------

            # --- AUTO-DISCOVERY IMAGE LOGIC ---
            row_hash['number'] = row_hash['number'].to_s.strip
            number = row_hash['number']

            row_hash['category'] = row_hash['category'].to_s.strip

            # 1. Extra images are whatever is actually on disk. Gaps in the
            #    numbering (e.g. -1, -3, -4 with -2 missing) are tolerated:
            #    every present image is rendered, in ascending index order.
            indices = extra_indices.fetch(number, [])

            # 2. Save to data. 'images' counts the main image plus the extras;
            #    'image_indices' tells the lightbox which suffixes actually exist.
            row_hash['images'] = 1 + indices.length
            row_hash['image_indices'] = indices
            row_hash
            # ----------------------------------
          end.compact # .compact removes all the 'nil' values (the pending items)

          site.data['catalog'] = rows

        rescue => e
          puts "❌ [CatalogGenerator] Error: #{e.message}"
        end
      else
        puts "⚠️ [CatalogGenerator] Could not find file: #{csv_path}"
      end
    end
  end
end
