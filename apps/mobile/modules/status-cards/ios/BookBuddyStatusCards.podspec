Pod::Spec.new do |s|
  s.name             = 'BookBuddyStatusCards'
  s.version          = '1.0.0'
  s.summary          = 'BookBuddy local status surfaces'
  s.description      = 'App-side ActivityKit bridge for locally started status cards.'
  s.license          = { :type => 'UNLICENSED' }
  s.author           = 'BookBuddy'
  s.homepage         = 'https://bookbuddy.app'
  s.source           = { :path => '.' }
  s.platform         = :ios, '16.2'
  s.swift_version    = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files     = '*.swift'
end
