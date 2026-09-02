# Corrects the x-default hreflang emitted by jekyll-polyglot 1.12.0.
#
# I18n_Headers emits a correct x-default pointing at the default-language URL,
# but polyglot's own :post_render hook then relativizes URLs in the rendered
# output. Its negative lookbehind exempts rel="canonical" and
# hreflang="<default_lang>" from that rewrite — but not hreflang="x-default".
# So on every non-default-language page, x-default was rewritten to that page's
# own language, leaving /en/, /nl/ and /de/ each claiming to be x-default.
#
# Registered with priority :low so it runs after polyglot's post_render hook
# regardless of the order in which plugins and gems are loaded.
Jekyll::Hooks.register :site, :post_render, priority: :low do |site|
  base = "#{site.config['url']}#{site.config['baseurl']}"

  fix_x_default = lambda do |doc|
    next if doc.output.nil?
    # HTML only. site.pages also carries sitemap.xml, whose x-default entries
    # describe *other* pages -- rewriting those to the sitemap's own url would
    # point every entry at /sitemap.xml.
    next unless doc.respond_to?(:output_ext) && doc.output_ext == '.html'
    next unless doc.output.include?('x-default')

    # doc.url carries no language prefix (polyglot prefixes the destination
    # directory, not the url), so it is already the default-language path.
    doc.output = doc.output.gsub(/(hreflang="x-default"\s+href=")[^"]*(")/) do
      "#{Regexp.last_match(1)}#{base}#{doc.url}#{Regexp.last_match(2)}"
    end
  end

  site.pages.each(&fix_x_default)
  site.collections.each_value { |c| c.docs.each(&fix_x_default) }
end
